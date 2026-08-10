"use client";

import { DirectionAwareHover } from "@asm/ui/components/ui/direction-aware-hover";
import { Badge } from "@asm/ui/shadui/badge";
import { Button } from "@asm/ui/shadui/button";
import { Card, CardContent } from "@asm/ui/shadui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@asm/ui/shadui/dropdown-menu";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@asm/ui/shadui/tabs";
import { BookOpen, Edit, Plus, Settings, Upload } from "lucide-react";
import { motion } from "motion/react";
import type React from "react";

interface MyPostsProps {
  data: {
    blogs: Array<{
      title: string;
      date: string;
      likes: number;
      comments: number;
      image: string;
    }>;
    researchPapers: Array<{
      title: string;
      date: string;
      citations: number;
    }>;
  };
}

const MyPosts: React.FC<MyPostsProps> = ({ data }) => (
  <Card className="bg-card text-card-foreground">
    <CardContent className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-semibold text-lg text-muted-foreground uppercase">
          My Posts
        </h2>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              className="bg-primary text-primary-foreground hover:bg-primary/90"
              size="sm"
            >
              <Plus className="mr-2 h-4 w-4" />
              New Post
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem>
              <Edit className="mr-2 h-4 w-4" /> Create Blog Post
            </DropdownMenuItem>
            <DropdownMenuItem>
              <BookOpen className="mr-2 h-4 w-4" /> Create Research Paper
            </DropdownMenuItem>
            <DropdownMenuItem>
              <Upload className="mr-2 h-4 w-4" /> Upload Existing Post
            </DropdownMenuItem>
            <DropdownMenuItem>
              <Settings className="mr-2 h-4 w-4" /> Manage Categories
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <Tabs className="mb-4" defaultValue="blogs">
        <TabsList className="bg-muted">
          <TabsTrigger
            className="text-muted-foreground transition-colors hover:text-foreground data-[state=active]:bg-background data-[state=active]:text-foreground"
            value="blogs"
          >
            Blogs
          </TabsTrigger>
          <TabsTrigger
            className="text-muted-foreground transition-colors hover:text-foreground data-[state=active]:bg-background data-[state=active]:text-foreground"
            value="research"
          >
            Research Papers
          </TabsTrigger>
        </TabsList>
        <TabsContent value="blogs">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            <div className="relative overflow-hidden rounded-lg shadow-md">
              {data.blogs.map((post, _index) => (
                <motion.div key={post.title} whileHover={{ scale: 1.05 }}>
                  <div className="relative h-128 w-full">
                    <DirectionAwareHover
                      className="h-full w-full object-cover"
                      imageUrl={post.image}
                    >
                      <div className="p-0">
                        <h3 className="font-semibold text-white">
                          {post.title}
                        </h3>
                        <p className="text-gray-300 text-sm">{post.date}</p>
                        <div className="mt-2 flex items-center space-x-4">
                          <span className="text-sm text-white">
                            {post.likes} likes
                          </span>
                          <span className="text-sm text-white">
                            {post.comments} comments
                          </span>
                        </div>
                      </div>
                    </DirectionAwareHover>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </TabsContent>
        <TabsContent value="research">
          <div className="space-y-4">
            {data.researchPapers.map((paper, _index) => (
              <div
                className="flex items-center justify-between rounded-lg bg-muted p-4"
                key={paper.title}
              >
                <div>
                  <h3 className="font-semibold text-foreground">
                    {paper.title}
                  </h3>
                  <p className="text-muted-foreground text-sm">{paper.date}</p>
                </div>
                <Badge variant="secondary">{paper.citations} citations</Badge>
              </div>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </CardContent>
  </Card>
);

export default MyPosts;
