// Web's `network-panels/panel-props.ts`, with `save` returning the native
// hook's promise and `clearActivity` passed down because native keeps the
// DELETE inside the hook.
import type {
  NetworkPreferences,
  NetworkProfile,
  NetworkSettings,
} from "@asm/protocols/discovery";

export interface NetworkPanelProps {
  catalog: string[];
  clearActivity: () => Promise<boolean>;
  isSaving: boolean;
  persona: NetworkSettings["persona"];
  preferences: NetworkPreferences;
  profile: NetworkProfile;
  revision?: number;
  save: (preferences: NetworkPreferences) => Promise<boolean>;
}
