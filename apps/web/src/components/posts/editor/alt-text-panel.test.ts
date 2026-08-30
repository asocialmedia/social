import { describe, expect, mock, test } from "bun:test";

interface AltResponse {
  isProcessing?: boolean;
  suggestedAlt?: string;
}

function handleAltApiResponse(
  status: number,
  data: AltResponse | null,
  setDraft: (draft: string) => void,
  toast: (opts: { description?: string; title: string }) => void
) {
  if (status === 200 && data) {
    if (data.suggestedAlt) {
      setDraft(data.suggestedAlt);
      toast({ title: "Alt text generated from media analysis" });
    } else if (data.isProcessing) {
      toast({
        description:
          "Media is still being transcribed and analyzed in the background. Please try again in a few moments.",
        title: "Analysis in progress",
      });
    } else {
      toast({
        description: "No spoken speech or text was detected in this media.",
        title: "No text detected",
      });
    }
  } else if (status === 401) {
    toast({
      description: "Your session expired. Please sign in again.",
      title: "Authentication required",
    });
  } else if (status === 404) {
    toast({
      description: "This media is no longer available.",
      title: "Media unavailable",
    });
  } else {
    toast({
      description:
        "Media is still being processed in the background. Please try again shortly.",
      title: "Analysis in progress",
    });
  }
}

describe("AltTextPanel auto-generation response handler", () => {
  test("updates draft and fires success toast when suggestedAlt is present", () => {
    let draft = "";
    const setDraft = (val: string) => {
      draft = val;
    };
    const toastCalls: { description?: string; title: string }[] = [];
    const toast = (opts: { description?: string; title: string }) => {
      toastCalls.push(opts);
    };

    handleAltApiResponse(
      200,
      { suggestedAlt: "Video with spoken dialogue: 'Hello'" },
      setDraft,
      toast
    );

    expect(draft).toBe("Video with spoken dialogue: 'Hello'");
    expect(toastCalls).toEqual([
      { title: "Alt text generated from media analysis" },
    ]);
  });

  test("does not update draft and shows progress toast when isProcessing is true", () => {
    let draft = "";
    const setDraft = (val: string) => {
      draft = val;
    };
    const toastCalls: { description?: string; title: string }[] = [];
    const toast = (opts: { description?: string; title: string }) => {
      toastCalls.push(opts);
    };

    handleAltApiResponse(200, { isProcessing: true }, setDraft, toast);

    expect(draft).toBe("");
    expect(toastCalls[0]?.title).toBe("Analysis in progress");
  });

  test("does not update draft and shows no-text toast when response is empty", () => {
    let draft = "";
    const setDraft = (val: string) => {
      draft = val;
    };
    const toastCalls: { description?: string; title: string }[] = [];
    const toast = (opts: { description?: string; title: string }) => {
      toastCalls.push(opts);
    };

    handleAltApiResponse(
      200,
      { isProcessing: false, suggestedAlt: "" },
      setDraft,
      toast
    );

    expect(draft).toBe("");
    expect(toastCalls[0]?.title).toBe("No text detected");
  });

  test("handles 401 unauthorized gracefully", () => {
    const setDraft = mock(() => {});
    const toastCalls: { description?: string; title: string }[] = [];
    const toast = (opts: { description?: string; title: string }) => {
      toastCalls.push(opts);
    };

    handleAltApiResponse(401, null, setDraft, toast);

    expect(setDraft).not.toHaveBeenCalled();
    expect(toastCalls[0]?.title).toBe("Authentication required");
  });

  test("handles 404 media unavailable gracefully", () => {
    const setDraft = mock(() => {});
    const toastCalls: { description?: string; title: string }[] = [];
    const toast = (opts: { description?: string; title: string }) => {
      toastCalls.push(opts);
    };

    handleAltApiResponse(404, null, setDraft, toast);

    expect(setDraft).not.toHaveBeenCalled();
    expect(toastCalls[0]?.title).toBe("Media unavailable");
  });
});
