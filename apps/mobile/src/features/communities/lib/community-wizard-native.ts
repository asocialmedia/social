import { File, Paths } from "expo-file-system";

import { parseCommunityWizard } from "./community-wizard";
import type { CommunityWizardDraft } from "./community-wizard";

function draftFile(userId: string) {
  return new File(
    Paths.document,
    `community-create-${encodeURIComponent(userId)}.json`
  );
}
export function readCommunityWizard(
  userId: string
): CommunityWizardDraft | null {
  try {
    const file = draftFile(userId);
    return file.exists
      ? parseCommunityWizard(JSON.parse(file.textSync()))
      : null;
  } catch {
    return null;
  }
}
export function saveCommunityWizard(
  userId: string,
  draft: CommunityWizardDraft
): void {
  try {
    const file = draftFile(userId);
    file.create({ overwrite: true });
    file.write(JSON.stringify(draft));
  } catch {
    // A storage failure must not prevent creating a community.
  }
}
export function clearCommunityWizard(userId: string): void {
  try {
    const file = draftFile(userId);
    if (file.exists) {
      file.delete();
    }
  } catch {
    // The submitted community remains available if draft cleanup fails.
  }
}
