import type {
  NetworkPreferences,
  NetworkProfile,
  NetworkSettings,
} from "@asm/protocols/discovery";

export interface NetworkPanelProps {
  catalog: string[];
  isSaving: boolean;
  persona: NetworkSettings["persona"];
  preferences: NetworkPreferences;
  profile: NetworkProfile;
  save: (preferences: NetworkPreferences) => void;
}
