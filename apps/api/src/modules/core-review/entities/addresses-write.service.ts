import type { PrismaClient } from "@prisma/client";

import { CoreReviewRefValidator } from "../../../lib/core-review/ref-validation.js";
import { CoreReviewEntitiesWriteRepository } from "../core-review-entities-write.repo.js";
import { CoreReviewValidationError } from "../core-review-write.errors.js";
import { validationMessageFromIssues } from "../core-review-write.helpers.js";
import { pickAlias } from "../core-review-write.schema.js";
import { CoreReviewAddressComponentsRepository } from "./addresses-components.repo.js";
import { CoreReviewAddressesRepository } from "./addresses.repo.js";
import { refreshAddressSearchIndex } from "../../addresses/address-index.js";
import { getCoreReviewAddressDetail } from "./addresses.handler.js";

type ComponentPatchBody = {
    upsert?: Array<{
        id?: string;
        component_type_code: string;
        component_value: string;
        language_code: string;
        confidence_score?: number | null;
        match_type?: string | null;
    }>;
    delete_ids?: string[];
};

function parseComponentPatch(body: Record<string, unknown>): ComponentPatchBody | null {
    const raw = body.components ?? body.address_components;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return null;
    }
    const patch = raw as ComponentPatchBody;
    if (!patch.upsert?.length && !patch.delete_ids?.length) {
        return null;
    }
    return patch;
}

export class CoreReviewAddressesWriteService {
    private readonly prisma: PrismaClient;
    private readonly addressesRepo: CoreReviewAddressesRepository;
    private readonly componentsRepo: CoreReviewAddressComponentsRepository;
    private readonly writeRepo: CoreReviewEntitiesWriteRepository;
    private readonly refValidator: CoreReviewRefValidator;

    constructor(prisma: PrismaClient) {
        this.prisma = prisma;
        this.addressesRepo = new CoreReviewAddressesRepository(prisma);
        this.componentsRepo = new CoreReviewAddressComponentsRepository(prisma);
        this.writeRepo = new CoreReviewEntitiesWriteRepository(prisma);
        this.refValidator = new CoreReviewRefValidator(prisma);
    }

    private async applyComponentPatch(addressId: bigint, patch: ComponentPatchBody): Promise<void> {
        const deleteIds = (patch.delete_ids ?? [])
            .map((id) => {
                try {
                    return BigInt(id);
                } catch {
                    return null;
                }
            })
            .filter((id): id is bigint => id !== null);

        if (deleteIds.length > 0) {
            await this.componentsRepo.softDeleteComponents(addressId, deleteIds);
        }

        for (const row of patch.upsert ?? []) {
            const code = row.component_type_code?.trim();
            const lang = row.language_code?.trim();
            if (!code || !row.component_value?.trim() || !lang) {
                continue;
            }
            await this.componentsRepo.upsertComponent(addressId, {
                id: row.id ? BigInt(row.id) : undefined,
                component_type_code: code,
                component_value: row.component_value.trim(),
                language_code: lang,
                confidence_score: row.confidence_score ?? null,
                match_type: row.match_type ?? null,
            });
        }

        await this.componentsRepo.refreshGeneratedFullAddress(addressId);
        await refreshAddressSearchIndex(this.prisma, [addressId]);
    }

    private stripReadonlyFullAddress(body: Record<string, unknown>): Record<string, unknown> {
        const next = { ...body };
        delete next.fullAddress;
        delete next.full_address;
        return next;
    }

    async create(body: Record<string, unknown>) {
        const componentPatch = parseComponentPatch(body);
        const workingBody = this.stripReadonlyFullAddress(body);

        const sourceTypeId = await this.resolveSourceTypeId(workingBody);
        const street = await this.refValidator.validateStreetPublicId(
            pickAlias<string | null>(workingBody, "streetId", "street_id") ?? null
        );
        if (street.issues.length > 0) {
            throw new CoreReviewValidationError(
                validationMessageFromIssues(street.issues),
                street.issues
            );
        }

        await this.validateRefs(workingBody, sourceTypeId);

        let fullAddress =
            pickAlias<string | null>(body, "fullAddress", "full_address")?.trim() ?? null;

        if (componentPatch) {
            fullAddress = "pending";
        }

        if (!fullAddress && !componentPatch) {
            throw new CoreReviewValidationError("full_address or components required", [
                { path: "components", message: "Provide components or full_address" },
            ]);
        }

        const publicId = await this.writeRepo.createAddress(
            {
                ...workingBody,
                full_address: fullAddress === "pending" ? "—" : fullAddress,
            },
            sourceTypeId,
            street.internalId
        );

        if (!publicId) {
            throw new CoreReviewValidationError("Failed to create address", []);
        }

        const addressId = await this.addressesRepo.getAddressInternalId(publicId);
        if (addressId === null) {
            throw new CoreReviewValidationError("Failed to resolve created address", []);
        }

        if (componentPatch) {
            await this.applyComponentPatch(addressId, componentPatch);
        } else {
            await refreshAddressSearchIndex(this.prisma, [addressId]);
        }

        const detail = await getCoreReviewAddressDetail(this.addressesRepo, publicId);
        if (!detail) {
            throw new CoreReviewValidationError("Failed to load created address", []);
        }
        return detail;
    }

    async update(publicId: string, body: Record<string, unknown>) {
        const componentPatch = parseComponentPatch(body);
        const workingBody = this.stripReadonlyFullAddress(body);

        const addressId = await this.addressesRepo.getAddressInternalId(publicId);
        if (addressId === null) {
            return null;
        }

        if (componentPatch) {
            await this.applyComponentPatch(addressId, componentPatch);
        }

        const streetPublicId = pickAlias<string | null>(workingBody, "streetId", "street_id");
        let streetInternalId: bigint | null | undefined;
        if (streetPublicId !== undefined) {
            const street = await this.refValidator.validateStreetPublicId(streetPublicId);
            if (street.issues.length > 0) {
                throw new CoreReviewValidationError("Validation failed", street.issues);
            }
            streetInternalId = street.internalId;
        }

        const scalarKeys = Object.keys(workingBody).filter(
            (k) => k !== "components" && k !== "address_components"
        );
        const hasScalarUpdates = scalarKeys.length > 0;

        if (hasScalarUpdates) {
            await this.validateRefs(workingBody, undefined);
            const ok = await this.writeRepo.updateAddress(publicId, workingBody, streetInternalId);
            if (!ok && !componentPatch) {
                return null;
            }
        }

        await refreshAddressSearchIndex(this.prisma, [addressId]);

        return getCoreReviewAddressDetail(this.addressesRepo, publicId, { anyStatus: true });
    }

    private async resolveSourceTypeId(body: Record<string, unknown>): Promise<bigint> {
        const explicit = pickAlias<bigint | null>(body, "sourceTypeId", "source_type_id");
        if (explicit !== undefined && explicit !== null) {
            return explicit;
        }
        const manual = await this.refValidator.resolveManualSourceTypeId();
        if (!manual) {
            throw new CoreReviewValidationError("manual source_type_id was not found", [
                { path: "sourceTypeId", message: "Default manual source type missing" },
            ]);
        }
        return manual;
    }

    private async validateRefs(
        body: Record<string, unknown>,
        sourceTypeId: bigint | undefined
    ): Promise<void> {
        const issues = await Promise.all([
            this.refValidator.validateAdminAreaId(
                pickAlias<bigint | null>(body, "adminAreaId", "admin_area_id") ?? null
            ),
            sourceTypeId !== undefined
                ? this.refValidator.validateSourceTypeId(sourceTypeId)
                : this.refValidator.validateSourceTypeId(
                      pickAlias<bigint | null>(body, "sourceTypeId", "source_type_id")
                  ),
        ]);
        const flat = issues.flat();
        if (flat.length > 0) {
            throw new CoreReviewValidationError(validationMessageFromIssues(flat), flat);
        }
    }
}
