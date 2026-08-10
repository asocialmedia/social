import { Card, CardContent, CardHeader, CardTitle } from "@asm/ui/shadui/card";

const SuggestedConnectionsSkeleton = () => (
  <Card className="bg-card shadow-md">
    <CardHeader>
      <CardTitle className="font-semibold text-muted-foreground text-sm uppercase">
        Suggested Connections
      </CardTitle>
    </CardHeader>
    <CardContent>
      <ul className="space-y-4">
        {Array.from({ length: 3 }).map((_, index) => (
          <li
            className="flex animate-pulse items-center justify-between"
            // biome-ignore lint/suspicious/noArrayIndexKey: skeleton components use index keys as order never changes
            key={`sc-skeleton-${index}`}
          >
            <div className="flex items-center space-x-3">
              <div className="h-8 w-8 rounded-full bg-muted" />
              <div className="space-y-2">
                <div className="h-4 w-24 rounded-md bg-muted" />
                <div className="h-3 w-16 rounded-md bg-muted" />
              </div>
            </div>
            <div className="h-8 w-20 rounded-md bg-muted" />
          </li>
        ))}
      </ul>
    </CardContent>
  </Card>
);

export default SuggestedConnectionsSkeleton;
