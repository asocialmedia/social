export function GET() {
  const team = process.env.APPLE_TEAM_ID?.trim();
  const appId =
    team && /^[A-Z0-9]{10}$/.test(team)
      ? `${team}.cc.asocialmedia.mobile`
      : null;
  return Response.json(
    {
      applinks: {
        apps: [],
        details: appId
          ? [
              {
                appID: appId,
                paths: [
                  "/network/bluesky*",
                  "/posts/*",
                  "/a/*",
                  "/users/*",
                  "/gusts*",
                  "/messages*",
                  "/settings*",
                ],
              },
            ]
          : [],
      },
      webcredentials: { apps: [appId ?? "cc.asocialmedia.mobile"] },
    },
    { headers: { "cache-control": "public, max-age=3600" } }
  );
}
