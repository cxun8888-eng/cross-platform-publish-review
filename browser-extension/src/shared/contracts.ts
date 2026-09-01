interface PublishDraftContract {
  version: 1;
  source: string;
  platform: "douyin" | "xiaohongshu" | "weibo";
  returnTarget: "workspace" | "wizard";
  title: string;
  content: string;
  tags: string[];
}

interface PublicationReceiptContract {
  version: 1;
  platform: PublishDraftContract["platform"];
  outcome: "triggered" | "resolved";
  returnMode: PublishDraftContract["returnTarget"];
  completedAt: string;
  workUrl?: string;
  title?: string;
  metrics?: Record<string, number>;
}
