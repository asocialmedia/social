"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@asm/ui/shadui/avatar";
import { Button } from "@asm/ui/shadui/button";
import { Card, CardContent } from "@asm/ui/shadui/card";
import { ChevronRight } from "lucide-react";
import { motion } from "motion/react";
import type React from "react";

interface RecommendationsProps {
  people: Array<{
    name: string;
    role: string;
    comment: string;
    avatar: string;
  }>;
}

const Recommendations: React.FC<RecommendationsProps> = ({ people }) => (
  <Card className="bg-card text-card-foreground">
    <CardContent className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-semibold text-muted-foreground text-sm uppercase">
          Endorsements based on your activity:
        </h2>
        <Button className="text-primary" variant="link">
          View all <ChevronRight className="ml-1 h-4 w-4" />
        </Button>
      </div>
      <div className="space-y-4">
        <div className="flex items-start space-x-4">
          {people.map((rec, index) => (
            <motion.div
              animate={{ opacity: 1, y: 0 }}
              initial={{ opacity: 0, y: 20 }}
              key={`${rec.name}-${rec.role}`}
              transition={{ delay: index * 0.1 }}
            >
              <Avatar>
                <AvatarImage
                  alt={rec.name}
                  height={64}
                  src={rec.avatar}
                  width={64}
                />
                <AvatarFallback>{rec.name[0]}</AvatarFallback>
              </Avatar>
              <div>
                <h3 className="font-semibold">{rec.name}</h3>
                <p className="text-muted-foreground text-xs">{rec.role}</p>
                <p className="mt-1 text-foreground text-sm">{rec.comment}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </CardContent>
  </Card>
);

export default Recommendations;
