import CoreVerificationFamilyClient from "@/src/features/core-verification/CoreVerificationFamilyClient";
import { coreVerificationLabel, familyFromCoreVerificationPath } from "@/src/features/core-verification/config";

export default async function CoreVerificationFamilyPage({
    params,
}: {
    params: Promise<{ family: string }>;
}) {
    const { family: path } = await params;
    const family = familyFromCoreVerificationPath(path) ?? path;
    return <CoreVerificationFamilyClient family={family} label={coreVerificationLabel(family)} />;
}
