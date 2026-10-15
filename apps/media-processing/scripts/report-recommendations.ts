import {
  closePrisma,
  closeQueueConnections,
  prisma,
  recommendationExperimentReport,
  redis,
  toPrismaDateTime,
} from "@asm/db";

try {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const events = await prisma.orm.public.RecommendationEvents.select(
    "durationMs",
    "eventType",
    "postId",
    "rankingContext",
    "userId"
  )
    .where((event) => event.createdAt.gte(toPrismaDateTime(since)))
    .orderBy((event) => event.createdAt.desc())
    .limit(50_000)
    .all();
  const report = {
    ...recommendationExperimentReport(events),
    note: "Descriptive cohort metrics; not proof of uplift. Actions use a qualified impression within the preceding hour. Compare sufficient per-user data before rollout.",
    sampled: events.length === 50_000,
    since: since.toISOString(),
  };
  const output = process.argv[2] ?? "/tmp/asm-recommendation-experiment.json";
  await Bun.write(output, JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify({
      events: events.length,
      groups: report.groups.length,
      output,
    })
  );
} finally {
  await closePrisma();
  await closeQueueConnections();
  redis.disconnect();
}
