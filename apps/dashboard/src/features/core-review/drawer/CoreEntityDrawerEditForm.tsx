"use client";

import { useCallback, useRef, useState } from "react";
import type { Map as MaplibreMap } from "maplibre-gl";

import { CoreReviewLoadingCard } from "@/src/components/core-review/CoreReviewStateCard";

import {
    CoreEntityEditBelowMapSection,
    CoreEntityEditExtrasSection,
    CoreEntityEditFieldsSection,
    CoreEntityEditMapSection,
    CoreEntityEditMetadataSection,
    resolveCoreEntityExternalId,
} from "../forms/CoreEntityEditFormSections";
import CoreEntityValidationPanel from "../forms/CoreEntityValidationPanel";
import CoreEntityWriteApiBanner from "../forms/CoreEntityWriteApiBanner";
import type { StreetSplitMapProps } from "../forms/StreetEditExtras";
import type { useCoreEntityEditForm } from "./useCoreEntityEditForm";

export type CoreEntityDrawerEditFormProps = {
    form: ReturnType<typeof useCoreEntityEditForm>;
    recordId: string;
};

export default function CoreEntityDrawerEditForm({ form, recordId }: CoreEntityDrawerEditFormProps) {
    const { config } = form;
    const [streetSplitMapProps, setStreetSplitMapProps] = useState<StreetSplitMapProps | null>(null);
    const placeHostMapRef = useRef<MaplibreMap | null>(null);

    const handleStreetSplitMapPropsChange = useCallback((props: StreetSplitMapProps) => {
        setStreetSplitMapProps(props);
    }, []);

    if (form.isLoading) {
        return <CoreReviewLoadingCard message={`Loading ${config.label.toLowerCase()}…`} />;
    }

    if (form.loadError) {
        return (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                {form.loadError}
            </div>
        );
    }

    const externalId = resolveCoreEntityExternalId(form.detail);

    const sectionProps = {
        entityKey: config.entityKey,
        mode: "edit" as const,
        config,
        recordId,
        control: form.control,
        watch: form.watch,
        setValue: form.setValue,
        errors: form.errors,
        refStates: form.refStates,
        detail: form.detail,
        disabled: form.formDisabled,
        isSaving: form.isSaving,
        externalId,
        onGeometryValidation: form.setGeometryValidation,
        onApiValidation: form.setApiGeometryValidation,
        streetSplitMapProps,
        onStreetSplitMapPropsChange: handleStreetSplitMapPropsChange,
        placeHostMapRef,
        reloadDetail: form.reloadDetail,
    };

    return (
        <div className="space-y-4">
            {!config.writeApiAvailable ? <CoreEntityWriteApiBanner /> : null}
            {config.formNotice ?? null}
            {form.isRecordDeleted ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
                    This record is soft-deleted. Restore it to edit fields or save changes again.
                </div>
            ) : null}

            <CoreEntityEditMapSection {...sectionProps} />

            <CoreEntityEditBelowMapSection {...sectionProps} />

            <CoreEntityValidationPanel
                fieldErrors={form.errors}
                geometryValidation={form.geometryValidation}
                apiGeometryValidation={form.apiGeometryValidation}
                formError={form.saveError}
            />

            <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
                <CoreEntityEditFieldsSection {...sectionProps} />
            </div>

            <CoreEntityEditMetadataSection {...sectionProps} />

            <CoreEntityEditExtrasSection {...sectionProps} />
        </div>
    );
}
