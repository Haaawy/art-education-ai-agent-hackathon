CREATE TABLE IF NOT EXISTS `ai_artwork_analyses` (
  `id` int NOT NULL AUTO_INCREMENT,
  `artworkId` int NOT NULL,
  `teacherId` int NOT NULL,
  `studentId` int NULL,
  `resultJson` text NOT NULL,
  `provider` varchar(80) NOT NULL,
  `promptVersion` varchar(80) NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `ai_artwork_analyses_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint

CREATE INDEX `idx_ai_artwork_analyses_artworkId` ON `ai_artwork_analyses` (`artworkId`);
--> statement-breakpoint
CREATE INDEX `idx_ai_artwork_analyses_teacherId` ON `ai_artwork_analyses` (`teacherId`);
--> statement-breakpoint
CREATE INDEX `idx_ai_artwork_analyses_studentId` ON `ai_artwork_analyses` (`studentId`);
