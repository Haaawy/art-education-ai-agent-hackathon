import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { ENV } from "./_core/env";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { getDb } from "./db";
import { 
  classes, classStudents, artworks, lessons, challenges, 
  challengeSubmissions, badges, studentBadges, studentPoints, 
  reviews, dailyAttendance, studentGrades, artworkVotes, users,
  competitions, competitionArtworkVotes, teacherCompetitions, competitionSubmissions, artworkAiFeedback,
  quizzes, quizResults, notifications, certificates, learningPaths,
  pathLessons,
  certificateTemplates,
  teacherProfiles,
  gradeSettings, giftedStudents, bannedUsers, adminActivityLogs, aboutPageSettings, showcaseSettings,
  siteGallerySettings, teacherGallerySettings, classGallerySettings, studentGallerySettings,
  contentImportJobs, contentSourceRecords,
  aiArtworkAnalyses,
  uploadedAssets,
  uploadedAssetReferences,
  videoImportJobs,
  lessonVideoAssets,
  subscriptionPlans,
  subscriptionActivationCodes,
  teacherSubscriptions,
  subscriptionEvents,
  supportRequests,
} from "../drizzle/schema";
import * as db from "./db";
import { asc, eq, and, desc, sql, or, isNull, inArray, lte, gte, getTableColumns } from "drizzle-orm";
import { storageDelete, storageGet, storagePut } from "./storage";
import { TRPCError } from "@trpc/server";
import { createHash } from "node:crypto";
import path from "node:path";
import type { SQL } from "drizzle-orm";
import { checkAdminPassword, resolveAdminAuth, upsertAdminAuth } from "./_core/adminAuth";
import {
  notifyAdminSupportRequest,
  notifyUserSupportRequestCreated,
  notifyUserSupportRequestStatusChanged,
} from "./_core/notification";
import {
  assertCanBanUser,
  assertCanChangeRole,
  assertCanResetPassword,
  assertDeleteUsersDisabled,
  requireOwner,
} from "./_core/adminGuards";
import {
  AUDIT_LOG_DELETE_DISABLED_MESSAGE,
  assertAuditLogDeletionDisabled,
  logAdminAction,
} from "./_core/adminAuditLog";
import {
  getTeacherRegistrationById,
  getTeacherRegistrationByUsername,
  listTeacherRegistrationRequests,
  updateTeacherRegistrationStatus,
} from "./_core/teacherRegistration";
import { importFromApprovedPreview } from "./services/content-ingestion";
import {
  buildStorablePreviewPayload,
  createAndAnalyzePdfImportJob,
  PdfImportInputError,
  pdfDataUrlToBuffer,
} from "./services/pdf-import-job";
import { buildCurriculumContext } from "./ai/curriculum/curriculum-context";
import { generateCurriculumInsights } from "./ai/curriculum/curriculum-ai";
import { detectCurriculumGaps } from "./ai/curriculum/curriculum-gap-analysis";
import { suggestCurriculumActivities } from "./ai/curriculum/curriculum-activity-suggestions";
import { generateCurriculumProject } from "./ai/curriculum/curriculum-project-generator";
import { applyActivitySuggestion } from "./ai/curriculum/curriculum-apply-actions";
import { applyProjectProposal } from "./ai/curriculum/curriculum-apply-project-proposal";
import {
  createArtisticChallengeFromDraft,
  generateArtisticChallengeDrafts,
} from "./ai/curriculum/curriculum-artistic-challenges";
import { generateArtworkAiFeedback } from "./ai/artwork-ai-feedback";
import {
  countAssetActiveReferences,
  listOrphanImportedAssetCandidates,
  purgeOrphanImportedAssets,
  detachEntityAssetReferences,
  registerInternalAsset,
  replaceEntityAssetReferenceByUrl,
  safelyDeleteAssetIfUnreferenced,
} from "./services/uploaded-assets";
import {
  generateQuizQuestionsFromLesson,
  inferQuizSourceType,
  isQuizHidden,
  markQuizSource,
  setQuizHiddenMarker,
} from "./services/quiz-generation";
import { evaluateArtworkBadgesForEvent } from "./services/badge-events";
import {
  buildMaintenanceCommand,
  getMaintenanceJob,
  listMaintenanceTasks,
  startMaintenanceJob,
  type MaintenanceTask as RunnerMaintenanceTask,
} from "./services/maintenance-runner";
import { resolveCanonicalIds } from "./services/canonical-normalization";
import {
  buildStudentCertificateViewModel,
  canStudentReceivePathCertificate,
  getTeacherCertificateSettings,
} from "./services/certificate-view-model";
import {
  MeTubeIntegrationError,
  cancelMeTubeTask,
  pollMeTubeTaskStatus,
  submitToMeTube,
} from "./services/metube-client";
import {
  VideoImportFinalizeError,
  attachAssetReferenceToJob,
  registerImportedVideoAssetFromRemote,
  resolveRemoteFinalizeCandidateForJob,
} from "./services/video-import-finalize";
import {
  LessonVideoAssetsError,
  computeNextDisplayOrder,
  ensureAttachableVideoAsset,
  ensureLessonExists,
  ensurePrimaryForLesson,
  findImportJobByAsset,
  listLessonVideoAttachments,
} from "./services/lesson-video-assets";
import {
  DEFAULT_GRADE_SETTINGS,
  hasGradeSettingsOverflow,
  normalizeGradeSettings,
  validateStudentGradesAgainstSettings,
} from "@shared/grading";
import {
  cloneShowcaseSettings,
  DEFAULT_SHOWCASE_SETTINGS,
  normalizeShowcaseSettings,
  serializeShowcaseSettings,
} from "@shared/executive-showcase";
import { resolveEffectiveLessonsForTeacher } from "@shared/lesson-effective";
import {
  REQUEST_ONLY_SUBSCRIPTION_NOTE,
  SUBSCRIPTION_FEATURES,
  canStudentAccessPaidFeature,
  canUseFeature,
  countTeacherBeneficiaryStudents,
  ensureDefaultSubscriptionPlans,
  getTeacherEntitlements,
  getTeacherSubscriptionStatus,
  listTeacherUsersForSubscriptions,
  logSubscriptionEvent,
  redeemSubscriptionActivationCode,
} from "./services/subscription-entitlements";
import { analyzeStudentArtwork, getArtAiAgentRuntimeStatus } from "./_core/artAiAgent";

const isDefinedSql = (value: SQL<unknown> | undefined): value is SQL<unknown> => Boolean(value);

function normalizeBadgeIconValue(value: string | undefined): string | null {
  const normalized = String(value || "").trim();
  return normalized.length > 0 ? normalized : null;
}

function isValidHttpUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function normalizeComparableUrl(value: string | null | undefined): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname.replace(/\/+$/, "")}`.toLowerCase();
  } catch {
    return raw.toLowerCase();
  }
}

function isYouTubeLikeUrl(value: string | null | undefined): boolean {
  const raw = String(value || "").trim();
  if (!raw) return false;
  try {
    const host = new URL(raw).hostname.toLowerCase();
    return host.includes("youtube.com") || host.includes("youtu.be");
  } catch {
    return false;
  }
}

function isRemoteUrlTrustedForImport(input: {
  remoteUrl: string | null | undefined;
  sourceUrl: string | null | undefined;
}): boolean {
  const remoteUrl = String(input.remoteUrl || "").trim();
  if (!remoteUrl) return false;
  if (!isValidHttpUrl(remoteUrl)) return false;
  if (isYouTubeLikeUrl(remoteUrl)) return false;

  const normalizedRemote = normalizeComparableUrl(remoteUrl);
  const normalizedSource = normalizeComparableUrl(input.sourceUrl);
  if (normalizedSource && normalizedRemote === normalizedSource) return false;

  return true;
}

function isLegacyScopeColumnError(error: unknown): boolean {
  const message = String((error as { message?: string } | null)?.message || error || "").toLowerCase();
  if (!message.includes("unknown column")) return false;
  return [
    "lessonid",
    "contentscope",
    "ownerteacherid",
    "createdbyuserid",
    "sourcelessonid",
    "sourcepathid",
    "sourcequizid",
    "sourcechallengeid",
    "stageid",
    "gradeid",
    "termid",
    "subjectid",
    "gradelabelraw",
    "termlabelraw",
    "subjectlabelraw",
  ].some((token) => message.includes(token));
}

function isMissingTableError(error: unknown): boolean {
  const raw = error as any;
  const parts = Array.from(
    new Set(
      [
        raw,
        raw?.message,
        raw?.sqlMessage,
        raw?.cause,
        raw?.cause?.message,
        raw?.cause?.sqlMessage,
        raw?.stack,
      ]
        .filter(Boolean)
        .map((value) => String(value)),
    ),
  );

  let message = parts.join("\n").toLowerCase();

  // Some DB adapters hide important details in nested objects.
  if (!message && raw && typeof raw === "object") {
    try {
      message = JSON.stringify(raw).toLowerCase();
    } catch {
      message = "";
    }
  }

  const code = String(raw?.code || raw?.cause?.code || "").toLowerCase();
  if (code === "er_no_such_table") return true;

  if (
    message.includes("doesn't exist") ||
    message.includes("does not exist") ||
    message.includes("no such table") ||
    message.includes("relation does not exist")
  ) {
    return true;
  }

  // Drizzle/TRPC in production can surface wrapped SQL errors as Failed query strings.
  if (message.includes("failed query") && message.includes("from `")) {
    return (
      message.includes("sitegallerysettings") ||
      message.includes("teachergallerysettings") ||
      message.includes("classgallerysettings")
    );
  }

  return false;
}

function isMissingGallerySettingsSchemaError(error: unknown): boolean {
  if (isMissingTableError(error)) return true;
  const raw = error as any;
  const message = String(raw?.message || raw?.sqlMessage || raw || "").toLowerCase();
  const code = String(raw?.code || raw?.cause?.code || "").toLowerCase();

  if (code !== "er_bad_field_error" && !message.includes("unknown column")) {
    return false;
  }

  return (
    message.includes("slideshowenabled") ||
    message.includes("slideshowintervalseconds") ||
    message.includes("slideshowshowdetails") ||
    message.includes("visibility") ||
    message.includes("shareslug") ||
    message.includes("shareenabled") ||
    message.includes("showstudentname") ||
    message.includes("showstudentnames") ||
    message.includes("showfirstnameonly") ||
    message.includes("showartistname") ||
    message.includes("showschoolname") ||
    message.includes("showbadges") ||
    message.includes("showcertificates") ||
    message.includes("showvotes") ||
    message.includes("allowpublicviewing") ||
    message.includes("showinstudentpublicgallery") ||
    message.includes("showinclassgallery")
  );
}

function isMissingStudentPublicProfileAddonSchemaError(error: unknown): boolean {
  if (isMissingTableError(error)) return true;
  const raw = error as any;
  const message = String(raw?.message || raw?.sqlMessage || raw || "").toLowerCase();
  const code = String(raw?.code || raw?.cause?.code || "").toLowerCase();

  const isUnknownColumn = code === "er_bad_field_error" || message.includes("unknown column");
  const isMissingTable = code === "er_no_such_table" || message.includes("doesn't exist") || message.includes("does not exist");

  if (!isUnknownColumn && !isMissingTable) return false;

  return (
    message.includes("certificates") ||
    message.includes("studentbadges") ||
    message.includes("badges") ||
    message.includes("issuedate") ||
    message.includes("pdfurl") ||
    message.includes("isvisible")
  );
}

function withoutGallerySlideshowFields<T extends Record<string, unknown>>(payload: T): Omit<T, "slideshowEnabled" | "slideshowIntervalSeconds" | "slideshowShowDetails"> {
  const { slideshowEnabled: _slideshowEnabled, slideshowIntervalSeconds: _slideshowIntervalSeconds, slideshowShowDetails: _slideshowShowDetails, ...rest } = payload;
  return rest;
}

function withoutGallerySharingFields<T extends Record<string, unknown>>(
  payload: T,
): Omit<T, "visibility" | "shareSlug" | "shareEnabled" | "showStudentNames" | "showArtistName" | "allowPublicViewing"> {
  const {
    visibility: _visibility,
    shareSlug: _shareSlug,
    shareEnabled: _shareEnabled,
    showStudentNames: _showStudentNames,
    showArtistName: _showArtistName,
    allowPublicViewing: _allowPublicViewing,
    ...rest
  } = payload;
  return rest;
}

function normalizeGradeKey(value: string | null | undefined): string {
  const normalizedDigits = String(value || "")
    .toLowerCase()
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)));
  return normalizedDigits
    .replace(/[()\[\]{}]/g, " ")
    .replace(/[\u0640]/g, " ")
    .replace(/\bالصف\b/g, " ")
    .replace(/\bصف\b/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.replace(/^ال/, ""))
    .join(" ")
    .trim();
}

async function resolveCanonicalGradeIds(
  database: any,
  values: Array<string | null | undefined>,
): Promise<number[]> {
  const uniqueValues = Array.from(
    new Set(
      values
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  );

  if (uniqueValues.length === 0) return [];

  const resolved = await Promise.all(
    uniqueValues.map(async (value) => {
      const canonical = await resolveCanonicalIds(database, { gradeRaw: value });
      return canonical.gradeId ? Number(canonical.gradeId) : null;
    }),
  );

  return Array.from(
    new Set(resolved.filter((id): id is number => typeof id === "number" && id > 0)),
  );
}

function matchesGradeCanonicalFirst(input: {
  itemGradeId: number | null | undefined;
  itemGradeRaw: string | null | undefined;
  canonicalGradeIds: number[];
  normalizedLegacyGrades: Set<string>;
}): boolean {
  const itemGradeId = input.itemGradeId == null ? null : Number(input.itemGradeId);
  const canUseCanonical = input.canonicalGradeIds.length > 0 && itemGradeId != null;

  if (canUseCanonical) {
    return input.canonicalGradeIds.includes(itemGradeId);
  }

  const normalizedItemGrade = normalizeGradeKey(String(input.itemGradeRaw || ""));
  if (!normalizedItemGrade) return true;
  return input.normalizedLegacyGrades.has(normalizedItemGrade);
}

type FixedTermVisibility = "all" | "first" | "second";

function normalizeFixedTermVisibility(value: unknown): FixedTermVisibility {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "first") return "first";
  if (raw === "second") return "second";
  if (raw === "all") return "all";
  return "all";
}

function extractFixedTermFromContent(input: {
  termId?: number | null;
  termLabelRaw?: string | null;
}): FixedTermVisibility {
  const termId = input.termId == null ? null : Number(input.termId);
  if (termId === 1) return "first";
  if (termId === 2) return "second";

  const normalized = String(input.termLabelRaw || "")
    .toLowerCase()
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
    .replace(/[أإآٱ]/g, "ا")
    .replace(/[^a-z\u0621-\u064A0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) return "all";

  if (
    /\bfirst\b/.test(normalized) ||
    /\bterm\s*1\b/.test(normalized) ||
    /\bsemester\s*1\b/.test(normalized) ||
    /\bالفصل\s*(?:الدراسي\s*)?(?:الاول|اول|1)\b/.test(normalized)
  ) {
    return "first";
  }

  if (
    /\bsecond\b/.test(normalized) ||
    /\bterm\s*2\b/.test(normalized) ||
    /\bsemester\s*2\b/.test(normalized) ||
    /\bالفصل\s*(?:الدراسي\s*)?(?:الثاني|ثاني|2)\b/.test(normalized)
  ) {
    return "second";
  }

  return "all";
}

function isContentTermAllowedByClassPolicy(input: {
  classPolicy: FixedTermVisibility;
  contentTerm: FixedTermVisibility;
}): boolean {
  if (input.classPolicy === "all") return true;
  if (input.contentTerm === "all") return true;
  return input.classPolicy === input.contentTerm;
}

function isContentTermAllowedByStudentClasses(input: {
  classPolicies: FixedTermVisibility[];
  contentTerm: FixedTermVisibility;
}): boolean {
  if (input.classPolicies.length === 0) return false;
  return input.classPolicies.some((policy) =>
    isContentTermAllowedByClassPolicy({ classPolicy: policy, contentTerm: input.contentTerm })
  );
}

function fixedTermLabelFromVisibility(value: FixedTermVisibility): string | null {
  if (value === "first") return "الفصل الأول";
  if (value === "second") return "الفصل الثاني";
  return null;
}

function getSupportRequestTypeLabel(requestType: string): string {
  if (requestType === "subscription_help") return "مساعدة اشتراك";
  if (requestType === "password_reset") return "إعادة كلمة مرور";
  if (requestType === "technical_support") return "دعم فني";
  if (requestType === "account_issue") return "مشكلة حساب";
  return "أخرى";
}

function getSupportRequestStatusLabel(status: string): string {
  if (status === "new") return "جديد";
  if (status === "in_progress") return "قيد المعالجة";
  if (status === "resolved") return "تم الحل";
  if (status === "rejected") return "مرفوض";
  if (status === "closed") return "مغلق";
  return status;
}

const supportRequestInputSchema = z.object({
  requestType: z.enum(["subscription_help", "password_reset", "technical_support", "account_issue", "other"]),
  title: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.string().trim().min(3).max(120).optional(),
  ),
  message: z.string().trim().min(10).max(3000),
  requesterName: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.string().trim().max(255).optional(),
  ),
  contactEmail: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.string().trim().email().optional(),
  ),
  contactPhone: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.string().trim().max(50).optional(),
  ),
});

function getSupportRequestValidationMessage(issue: z.core.$ZodIssue): string {
  const field = String(issue.path[0] || "");
  if (field === "requesterName") return "الاسم مطلوب.";
  if (field === "contactEmail") return "البريد الإلكتروني غير صحيح.";
  if (field === "requestType") return "نوع الطلب مطلوب.";
  if (field === "title") return "عنوان الطلب يجب ألا يقل عن 3 أحرف وألا يتجاوز 120 حرفًا.";
  if (field === "message") return "الرسالة يجب ألا تقل عن 10 أحرف.";
  if (field === "contactPhone") return "رقم الهاتف غير صحيح.";
  return "بيانات طلب الدعم غير مكتملة.";
}

async function assertTeacherFeatureAccess(input: {
  user: { id: number; role: string };
  featureCode: keyof typeof SUBSCRIPTION_FEATURES extends never ? never : (typeof SUBSCRIPTION_FEATURES)[keyof typeof SUBSCRIPTION_FEATURES];
  message?: string;
}) {
  if (input.user.role === "admin") return;
  if (input.user.role !== "teacher") {
    throw new TRPCError({ code: "FORBIDDEN" });
  }

  const allowed = await canUseFeature(input.user.id, input.featureCode);
  if (!allowed) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        input.message ||
        "انتهى اشتراكك. بياناتك وبيانات طلابك محفوظة، ويمكنك التجديد لاستمرار استخدام المزايا المتقدمة.",
    });
  }
}

async function assertStudentPaidFeatureAccess(input: {
  studentId: number;
  featureCode: (typeof SUBSCRIPTION_FEATURES)[keyof typeof SUBSCRIPTION_FEATURES];
  ownerTeacherId?: number;
}) {
  const allowed = await canStudentAccessPaidFeature(input.studentId, input.featureCode, input.ownerTeacherId);
  if (!allowed) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "هذه الميزة غير متاحة حاليًا في حساب معلمك.",
    });
  }
}

async function canUserAccessLessonForPlayback(input: {
  database: any;
  user: { id: number; role: string };
  lesson: {
    id: number;
    classId: number | null;
    isVisible: boolean | null;
    contentScope: string | null;
    ownerTeacherId: number | null;
    teacherId: number | null;
    grade: string | null;
    gradeId: number | null;
    termId: number | null;
    termLabelRaw: string | null;
  };
}): Promise<boolean> {
  const { database, user, lesson } = input;

  if (user.role === "admin") return true;
  if (lesson.isVisible === false) return false;

  if (user.role === "teacher") {
    if (lesson.classId != null) {
      const classRows = await database
        .select({ id: classes.id })
        .from(classes)
        .where(and(eq(classes.id, Number(lesson.classId)), eq(classes.teacherId, user.id)))
        .limit(1);
      return Boolean(classRows[0]);
    }

    const isGlobal =
      lesson.contentScope === "global" ||
      (lesson.ownerTeacherId == null && lesson.classId == null);
    if (!isGlobal) {
      const ownerId = Number(lesson.ownerTeacherId || lesson.teacherId || 0);
      return ownerId > 0 && ownerId === Number(user.id);
    }

    const classRows = await database
      .select({ grade: classes.grade })
      .from(classes)
      .where(eq(classes.teacherId, user.id));

    const normalizedGrades = new Set<string>(
      classRows.map((row: any) => normalizeGradeKey(String(row.grade || ""))).filter(Boolean)
    );
    const canonicalGradeIds = await resolveCanonicalGradeIds(database, classRows.map((row: any) => row.grade));

    return matchesGradeCanonicalFirst({
      itemGradeId: lesson.gradeId,
      itemGradeRaw: lesson.grade,
      canonicalGradeIds,
      normalizedLegacyGrades: normalizedGrades,
    });
  }

  if (user.role === "student" || user.role === "user") {
    const studentClassRows = await database
      .select({
        classId: classStudents.classId,
        grade: classes.grade,
        teacherId: classes.teacherId,
        studentContentTermVisibility: classes.studentContentTermVisibility,
      })
      .from(classStudents)
      .innerJoin(classes, eq(classStudents.classId, classes.id))
      .where(eq(classStudents.studentId, user.id));

    if (studentClassRows.length === 0) return false;

    const classIds = Array.from(new Set(studentClassRows.map((row: any) => Number(row.classId))));
    const classPolicyById = new Map<number, FixedTermVisibility>();
    for (const row of studentClassRows) {
      classPolicyById.set(Number(row.classId), normalizeFixedTermVisibility(row.studentContentTermVisibility));
    }

    const teacherIds = Array.from(new Set(studentClassRows.map((row: any) => Number(row.teacherId))));
    const classPolicies = studentClassRows.map((row: any) =>
      normalizeFixedTermVisibility(row.studentContentTermVisibility)
    );
    const contentTerm = extractFixedTermFromContent({
      termId: lesson.termId,
      termLabelRaw: lesson.termLabelRaw,
    });
    if (lesson.classId != null) {
      const classPolicy = classPolicyById.get(Number(lesson.classId));
      if (!classPolicy) return false;
      return isContentTermAllowedByClassPolicy({ classPolicy, contentTerm });
    }
    const normalizedStudentGrades = new Set<string>(
      studentClassRows
        .map((row: any) => normalizeGradeKey(String(row.grade || "")))
        .filter(Boolean)
    );
    const canonicalStudentGradeIds = await resolveCanonicalGradeIds(
      database,
      studentClassRows.map((row: any) => row.grade)
    );

    const gradeMatches = matchesGradeCanonicalFirst({
      itemGradeId: lesson.gradeId,
      itemGradeRaw: lesson.grade,
      canonicalGradeIds: canonicalStudentGradeIds,
      normalizedLegacyGrades: normalizedStudentGrades,
    });

    if (!isContentTermAllowedByStudentClasses({ classPolicies, contentTerm })) {
      return false;
    }

    const isGlobal =
      lesson.contentScope === "global" ||
      (lesson.ownerTeacherId == null && lesson.classId == null);
    if (isGlobal) {
      return gradeMatches;
    }

    const ownerId = Number(lesson.ownerTeacherId || lesson.teacherId || 0);
    const belongsToMyTeacher = ownerId > 0 && teacherIds.includes(ownerId);
    return belongsToMyTeacher && gradeMatches;
  }

  return false;
}

async function syncLinkedChallengeTermsFromLesson(input: {
  database: any;
  lessonId: number;
}) {
  try {
    const lessonRows = await input.database
      .select({ termId: lessons.termId, termLabelRaw: lessons.termLabelRaw })
      .from(lessons)
      .where(eq(lessons.id, input.lessonId))
      .limit(1);

    const lessonRow = lessonRows[0];
    if (!lessonRow) return;

    await input.database
      .update(challenges)
      .set({
        termId: lessonRow.termId == null ? null : Number(lessonRow.termId),
        termLabelRaw: lessonRow.termLabelRaw == null ? null : String(lessonRow.termLabelRaw),
      })
      .where(eq(challenges.lessonId, input.lessonId));
  } catch (error) {
    if (isLegacyScopeColumnError(error)) {
      console.warn("[Content Scope] Skipping challenge-term sync due to schema drift", {
        lessonId: input.lessonId,
        reason: String((error as { message?: string } | null)?.message || error || "unknown"),
      });
      return;
    }

    throw error;
  }
}

async function assertPathTermConsistency(input: {
  database: any;
  pathTerm: FixedTermVisibility;
  lessonIds: number[];
}) {
  if (input.lessonIds.length === 0) return;

  const lessonsRows = await input.database
    .select({ id: lessons.id, termId: lessons.termId, termLabelRaw: lessons.termLabelRaw })
    .from(lessons)
    .where(inArray(lessons.id, input.lessonIds));

  const lessonTerms = lessonsRows.map((row: any) =>
    extractFixedTermFromContent({
      termId: row.termId == null ? null : Number(row.termId),
      termLabelRaw: row.termLabelRaw == null ? null : String(row.termLabelRaw),
    })
  );

  const hasFirst = lessonTerms.includes("first");
  const hasSecond = lessonTerms.includes("second");

  if (input.pathTerm === "first" && hasSecond) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "لا يمكن ربط دروس الفصل الثاني داخل مسار مضبوط على الفصل الأول" });
  }

  if (input.pathTerm === "second" && hasFirst) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "لا يمكن ربط دروس الفصل الأول داخل مسار مضبوط على الفصل الثاني" });
  }

  if (input.pathTerm === "all" && hasFirst && hasSecond) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "لا يمكن خلط دروس الفصل الأول والثاني داخل نفس المسار" });
  }
}

function inferQuizSemester(parts: Array<string | null | undefined>): "الفصل الأول" | "الفصل الثاني" | "غير محدد" {
  const raw = parts.filter(Boolean).map((part) => String(part)).join(" \n ");
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    decoded = raw;
  }
  const text = `${raw} ${decoded}`
    .toLowerCase()
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)));

  const termOnePatterns = [
    /الفصل[\s\-_]*1\b/i,
    /الفصل[\s\-_]*(الأول|الاول)\b/i,
    /semester[\s\-_]*1\b/i,
    /term[\s\-_]*1\b/i,
    /sem[\s\-_]*1\b/i,
  ];
  const termTwoPatterns = [
    /الفصل[\s\-_]*2\b/i,
    /الفصل[\s\-_]*الثاني\b/i,
    /semester[\s\-_]*2\b/i,
    /term[\s\-_]*2\b/i,
    /sem[\s\-_]*2\b/i,
  ];

  if (termOnePatterns.some((pattern) => pattern.test(text))) return "الفصل الأول";
  if (termTwoPatterns.some((pattern) => pattern.test(text))) return "الفصل الثاني";
  return "غير محدد";
}

type NormalizedQuizQuestion = {
  id: string;
  type: "multiple" | "truefalse" | "short_text";
  question: string;
  options: string[];
  correctAnswer: number | boolean | string;
  explanation: string;
  acceptableAnswers?: string[];
};

function parseAndNormalizeQuizQuestions(rawQuestions: string | null | undefined): NormalizedQuizQuestion[] {
  let parsed: any[] = [];
  try {
    parsed = JSON.parse(String(rawQuestions || "[]"));
  } catch {
    parsed = [];
  }

  return parsed
    .map((item, index) => {
      const rawType = String(item?.type || "").toLowerCase().replace(/[_\-\s]/g, "");
      const type: NormalizedQuizQuestion["type"] =
        rawType === "truefalse" || rawType === "boolean"
          ? "truefalse"
          : rawType === "multiple" || rawType === "multiplechoice" || rawType === "mcq"
            ? "multiple"
            : "short_text";

      const options = Array.isArray(item?.options)
        ? item.options.map((option: unknown) => String(option || "").trim()).filter(Boolean)
        : [];

      let correctAnswer: number | boolean | string = item?.correctAnswer;
      if (type === "multiple") {
        if (typeof correctAnswer !== "number") {
          const asNumber = Number(correctAnswer);
          correctAnswer = Number.isFinite(asNumber) ? asNumber : 0;
        }
        if (options.length < 2) {
          // Degenerate legacy MCQ is treated as short text to avoid broken UI.
          return {
            id: String(item?.id || `q-${index + 1}`),
            type: "short_text" as const,
            question: String(item?.question || "سؤال قصير").trim(),
            options: [],
            correctAnswer: String(item?.correctAnswer || "").trim(),
            explanation: String(item?.explanation || "").trim(),
            acceptableAnswers: Array.isArray(item?.acceptableAnswers)
              ? item.acceptableAnswers.map((value: unknown) => String(value || "").trim()).filter(Boolean)
              : [],
          };
        }
      }
      if (type === "truefalse") {
        if (typeof correctAnswer !== "boolean") {
          const normalized = String(correctAnswer || "").trim().toLowerCase();
          correctAnswer = ["true", "صح", "صحيح", "1"].includes(normalized);
        }
      }
      if (type === "short_text") {
        correctAnswer = String(correctAnswer || "").trim();
      }

      return {
        id: String(item?.id || `q-${index + 1}`),
        type,
        question: String(item?.question || "سؤال").trim(),
        options,
        correctAnswer,
        explanation: String(item?.explanation || "").trim(),
        acceptableAnswers: Array.isArray(item?.acceptableAnswers)
          ? item.acceptableAnswers.map((value: unknown) => String(value || "").trim()).filter(Boolean)
          : undefined,
      };
    })
    .filter((question) => question.question.length > 0);
}

function scoreQuizQuestions(questions: NormalizedQuizQuestion[]): number {
  const qualityBase = questions.length * 10;
  const multiple = questions.filter((question) => question.type === "multiple" && question.options.length >= 2).length;
  const tf = questions.filter((question) => question.type === "truefalse").length;
  const short = questions.filter((question) => question.type === "short_text").length;
  return qualityBase + multiple * 4 + tf * 3 + short * 2;
}

function detectVideoProvider(url: URL): "youtube" | "tiktok" | "vimeo" | "direct" | "other" {
  const host = url.hostname.toLowerCase();
  const path = url.pathname.toLowerCase();
  if (host.includes("youtube.com") || host.includes("youtu.be")) return "youtube";
  if (host.includes("tiktok.com")) return "tiktok";
  if (host.includes("vimeo.com")) return "vimeo";
  if (/\.(mp4|webm|ogg|mov|m4v)(\?|#|$)/i.test(path)) return "direct";
  return "other";
}

function extractFileNameFromUrl(rawUrl: string, fallback = "video") {
  try {
    const parsed = new URL(rawUrl);
    const name = parsed.pathname.split("/").pop() || fallback;
    return name;
  } catch {
    return fallback;
  }
}

function decodeMojibakeArabicFileName(value: string): string {
  if (!value) return value;
  try {
    const converted = Buffer.from(value, "latin1").toString("utf8");
    const originalHasArabic = /[\u0600-\u06FF]/.test(value);
    const convertedHasArabic = /[\u0600-\u06FF]/.test(converted);
    const likelyMojibake = /[ØÙÃÂÐ]/.test(value);
    if (!originalHasArabic && convertedHasArabic && likelyMojibake) {
      return converted;
    }
    return value;
  } catch {
    return value;
  }
}

function resolveDisplayImportFileName(fileName: string, title?: string | null): string {
  const decoded = decodeMojibakeArabicFileName(fileName || "").trim();
  if (decoded) return decoded;
  return (title || fileName || "").trim();
}

function toSafePage(value: unknown, fallback = 1): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.round(parsed));
}

function toSafeName(value: unknown, fallback: string): string {
  const text = String(value || "").trim();
  return text || fallback;
}

function recomputePreviewSummary(preview: any) {
  let pathsCount = 0;
  let lessonsCount = 0;
  let challengesCount = 0;
  let quizzesCount = 0;
  let uncategorizedCount = 0;

  const terms = Array.isArray(preview?.outline?.terms) ? preview.outline.terms : [];
  for (const term of terms) {
    const domains = Array.isArray(term?.domains) ? term.domains : [];
    for (const domain of domains) {
      if (!domain?.ignored) {
        pathsCount += 1;
      }

      const domainName = String(domain?.name || "");
      if (domainName.includes("غير مصنف")) {
        uncategorizedCount += 1;
      }

      const units = Array.isArray(domain?.units) ? domain.units : [];
      for (const unit of units) {
        const lessons = Array.isArray(unit?.lessons) ? unit.lessons : [];
        for (const lesson of lessons) {
          if (!lesson?.ignored) {
            lessonsCount += 1;
          }
          challengesCount += Array.isArray(lesson?.activities)
            ? lesson.activities.filter((item: any) => !item?.ignored).length
            : 0;
          quizzesCount += Array.isArray(lesson?.assessments)
            ? lesson.assessments.filter((item: any) => !item?.ignored).length
            : 0;
        }
      }
    }
  }

  return {
    pathsCount,
    lessonsCount,
    challengesCount,
    quizzesCount,
    uncategorizedCount,
  };
}

function normalizePreviewForOverrides(preview: any) {
  const clone = JSON.parse(JSON.stringify(preview || {}));
  applyMergedLessonState(clone);
  clone.summary = recomputePreviewSummary(clone);
  return clone;
}

function stripMergedSourcePrefix(name: string): string {
  return String(name || "").replace(/^\[MERGED_SOURCE\]\s*/i, "").trim();
}

function applyMergedLessonState(preview: any): void {
  const terms = Array.isArray(preview?.outline?.terms) ? preview.outline.terms : [];

  for (const term of terms) {
    const domains = Array.isArray(term?.domains) ? term.domains : [];
    for (const domain of domains) {
      const units = Array.isArray(domain?.units) ? domain.units : [];
      for (const unit of units) {
        const lessons = Array.isArray(unit?.lessons) ? unit.lessons : [];
        const lessonById = new Map<string, any>();
        for (const lesson of lessons) {
          if (lesson?.id) {
            lessonById.set(String(lesson.id), lesson);
          }
        }

        for (const source of lessons) {
          const targetId = String(source?.mergedIntoLessonId || "").trim();
          if (!targetId) continue;

          source.ignored = true;
          source.hidden = true;

          const target = lessonById.get(targetId);
          if (!target) continue;

          const sourceName = String(source?.mergedSourceOriginalName || stripMergedSourcePrefix(String(source?.name || ""))).trim();
          if (sourceName && !String(target?.name || "").includes(sourceName)) {
            target.name = `${String(target?.name || "").trim()} + ${sourceName}`;
          }

          const sourceFrom = toSafePage(source?.pageFrom, 1);
          const sourceTo = toSafePage(source?.pageTo, sourceFrom);
          const targetFrom = toSafePage(target?.pageFrom, sourceFrom);
          const targetTo = toSafePage(target?.pageTo, Math.max(sourceTo, targetFrom));
          target.pageFrom = Math.min(sourceFrom, targetFrom);
          target.pageTo = Math.max(sourceTo, targetTo);

          const mergedIds = Array.isArray(target?.mergedLessonIds) ? target.mergedLessonIds : [];
          if (!mergedIds.includes(String(source.id))) {
            target.mergedLessonIds = [...mergedIds, String(source.id)];
          }
        }
      }
    }
  }
}

function normalizeAiText(value: unknown): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

type CompetitionPlace = "first" | "second" | "third" | null;
type TeacherCompetitionStatus = "draft" | "active" | "closed" | "published";
type CompetitionSubmissionStatus = "pending" | "approved" | "rejected" | "winner" | "featured";
type CompetitionAwardRank = "first" | "second" | "third" | null;

function resolveCompetitionPlaceLabel(place: CompetitionPlace): string | null {
  if (place === "first") return "🥇 المركز الأول";
  if (place === "second") return "🥈 المركز الثاني";
  if (place === "third") return "🥉 المركز الثالث";
  return null;
}

async function canAccessArtworkAiFeedback(params: {
  artworkId: number;
  user: { id: number; role: string };
}) {
  const database = await getDb();
  if (!database) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "قاعدة البيانات غير متاحة" });
  }

  const artworkRows = await database
    .select({
      id: artworks.id,
      classId: artworks.classId,
      studentId: artworks.studentId,
      title: artworks.title,
      description: artworks.description,
      imageUrl: artworks.imageUrl,
      lessonId: artworks.lessonId,
    })
    .from(artworks)
    .where(eq(artworks.id, params.artworkId))
    .limit(1);

  const artwork = artworkRows[0];
  if (!artwork) {
    throw new TRPCError({ code: "NOT_FOUND", message: "العمل الفني غير موجود" });
  }

  const isAdmin = params.user.role === "admin";

  let isTeacherOfClass = false;
  if (params.user.role === "teacher" && artwork.classId) {
    const classRows = await database
      .select({ teacherId: classes.teacherId })
      .from(classes)
      .where(eq(classes.id, artwork.classId))
      .limit(1);
    isTeacherOfClass = classRows[0]?.teacherId === params.user.id;
  }

  if (!isAdmin && !isTeacherOfClass) {
    throw new TRPCError({ code: "FORBIDDEN", message: "غير مصرح لك بالوصول إلى ملاحظات هذا العمل" });
  }

  return { database, artwork };
}

type BadgeCategory = "artwork" | "participation" | "challenge" | "special";

const AUTO_BADGES = {
  firstArtwork: {
    name: "أول عمل فني",
    description: "أنجز أول عمل فني داخل المنصة",
    category: "artwork" as BadgeCategory,
  },
  firstReviewedArtwork: {
    name: "أول عمل تمت مراجعته",
    description: "حصل أول عمل لك على مراجعة من المعلم",
    category: "artwork" as BadgeCategory,
  },
  firstPublishedArtwork: {
    name: "أول عمل منشور",
    description: "نُشر أول عمل لك في المعرض العام للمنصة",
    category: "artwork" as BadgeCategory,
  },
  featuredArtist: {
    name: "فنان مميز",
    description: "تم تمييز أحد أعمالك كعمل مميز",
    category: "special" as BadgeCategory,
  },
  challengeFinisher: {
    name: "منجز التحدي",
    description: "أكملت أول تحدٍ فني داخل المنصة",
    category: "challenge" as BadgeCategory,
  },
  competitionParticipant: {
    name: "مشارك في مسابقة",
    description: "شارك لأول مرة في مسابقة فنية داخل المنصة",
    category: "special" as BadgeCategory,
  },
  competitionWinner: {
    name: "فائز في مسابقة",
    description: "حقق مركزًا فائزًا ضمن نتائج مسابقة فنية",
    category: "special" as BadgeCategory,
  },
  firstPlaceArtist: {
    name: "فنان المركز الأول",
    description: "حقق المركز الأول في مسابقة فنية",
    category: "special" as BadgeCategory,
  },
  popularArtwork: {
    name: "عمل جماهيري مميز",
    description: "حصل عملك على أعلى تصويت جماهيري في مسابقة",
    category: "special" as BadgeCategory,
  },
} as const;

async function ensureBadgeByNameWithOptions(
  name: string,
  description: string,
  options?: { category?: BadgeCategory; iconUrl?: string; isVisible?: boolean }
) {
  const database = await getDb();
  if (!database) return null;

  const rows = await database
    .select({ id: badges.id })
    .from(badges)
    .where(eq(badges.name, name))
    .limit(1);

  if (rows[0]) return rows[0].id;

  const insertResult = await database.insert(badges).values({
    name,
    description,
    iconUrl: options?.iconUrl,
    category: options?.category ?? "challenge",
    requirement: 1,
    isVisible: options?.isVisible ?? true,
  });

  const insertedId = Number(
    ((insertResult as { insertId?: unknown } | undefined)?.insertId) ??
      (Array.isArray(insertResult)
        ? (insertResult[0] as { insertId?: unknown } | undefined)?.insertId
        : undefined)
  );

  if (Number.isFinite(insertedId) && insertedId > 0) return insertedId;

  const refetch = await database
    .select({ id: badges.id })
    .from(badges)
    .where(eq(badges.name, name))
    .limit(1);

  return refetch[0]?.id ?? null;
}

async function awardBadgeToStudent(
  studentId: number,
  badgeName: string,
  badgeDescription: string,
  options?: { category?: BadgeCategory; iconUrl?: string; isVisible?: boolean }
) {
  const database = await getDb();
  if (!database) return;

  const badgeId = await ensureBadgeByNameWithOptions(badgeName, badgeDescription, options);
  if (!badgeId) return;

  const existing = await database
    .select({ id: studentBadges.id })
    .from(studentBadges)
    .where(and(eq(studentBadges.studentId, studentId), eq(studentBadges.badgeId, badgeId)))
    .limit(1);

  if (existing[0]) return;

  await database.insert(studentBadges).values({ studentId, badgeId });
}

async function awardAutoBadge(studentId: number, badgeKey: keyof typeof AUTO_BADGES) {
  const badge = AUTO_BADGES[badgeKey];
  await awardBadgeToStudent(studentId, badge.name, badge.description, {
    category: badge.category,
    isVisible: true,
  });
}

async function countStudentArtworks(studentId: number): Promise<number> {
  const database = await getDb();
  if (!database) return 0;
  const rows = await database
    .select({ count: sql<number>`count(*)` })
    .from(artworks)
    .where(eq(artworks.studentId, studentId));
  return Number(rows[0]?.count || 0);
}

async function countStudentReviewedArtworks(studentId: number): Promise<number> {
  const database = await getDb();
  if (!database) return 0;
  const rows = await database
    .select({ count: sql<number>`count(*)` })
    .from(reviews)
    .innerJoin(artworks, eq(reviews.artworkId, artworks.id))
    .where(eq(artworks.studentId, studentId));
  return Number(rows[0]?.count || 0);
}

async function countStudentPublishedArtworks(studentId: number): Promise<number> {
  const database = await getDb();
  if (!database) return 0;
  const rows = await database
    .select({ count: sql<number>`count(*)` })
    .from(artworks)
    .where(and(eq(artworks.studentId, studentId), eq(artworks.status, "published"), eq(artworks.isPublic, true)));
  return Number(rows[0]?.count || 0);
}

async function countStudentFeaturedArtworks(studentId: number): Promise<number> {
  const database = await getDb();
  if (!database) return 0;
  const rows = await database
    .select({ count: sql<number>`count(*)` })
    .from(artworks)
    .where(and(eq(artworks.studentId, studentId), eq(artworks.isFeatured, true)));
  return Number(rows[0]?.count || 0);
}

async function countStudentChallengeSubmissions(studentId: number): Promise<number> {
  const database = await getDb();
  if (!database) return 0;
  const rows = await database
    .select({ count: sql<number>`count(*)` })
    .from(challengeSubmissions)
    .where(eq(challengeSubmissions.studentId, studentId));
  return Number(rows[0]?.count || 0);
}

async function maybeAwardFirstArtwork(studentId: number) {
  await evaluateArtworkBadgesForEvent({ eventType: "artwork_created", studentId });
}

async function maybeAwardFirstReviewedArtwork(studentId: number) {
  if ((await countStudentReviewedArtworks(studentId)) === 1) {
    await awardAutoBadge(studentId, "firstReviewedArtwork");
  }
}

// Phase-1 definition of "published": artwork is in public gallery state (status=published + isPublic=true).
async function maybeAwardFirstPublishedArtwork(studentId: number) {
  await evaluateArtworkBadgesForEvent({ eventType: "artwork_published", studentId });
}

async function maybeAwardFeaturedArtist(studentId: number) {
  await evaluateArtworkBadgesForEvent({ eventType: "artwork_featured", studentId });
}

async function maybeAwardChallengeFinisher(studentId: number) {
  if ((await countStudentChallengeSubmissions(studentId)) === 1) {
    await awardAutoBadge(studentId, "challengeFinisher");
  }
}

async function maybeAwardCompetitionParticipant(studentId: number) {
  await awardAutoBadge(studentId, "competitionParticipant");
}

async function maybeAwardCompetitionWinner(studentId: number) {
  await awardAutoBadge(studentId, "competitionWinner");
}

async function maybeAwardFirstPlaceArtist(studentId: number) {
  await awardAutoBadge(studentId, "firstPlaceArtist");
}

async function maybeAwardPopularArtworkForCompetition(competitionId: number) {
  const database = await getDb();
  if (!database) return;

  const participantRows = await database
    .select({
      artworkId: artworks.id,
      studentId: artworks.studentId,
      votes: artworks.competitionVotes,
    })
    .from(artworks)
    .where(and(eq(artworks.competitionId, competitionId), eq(artworks.showInCompetition, true)));

  if (participantRows.length === 0) return;

  const maxVotes = Math.max(...participantRows.map((row) => Number(row.votes || 0)));
  if (maxVotes <= 0) return;

  const leaders = participantRows.filter((row) => Number(row.votes || 0) === maxVotes);
  // In case of tie, skip auto-award until a deterministic tie-break policy is introduced.
  if (leaders.length !== 1) return;

  await awardAutoBadge(leaders[0].studentId, "popularArtwork");
}

function buildLessonAiDraft(input: {
  mode: "quick" | "full";
  title: string;
  grade?: string;
  subject?: string;
  category?: "drawing" | "decoration" | "colors" | "texture";
  lessonContext?: string;
  currentDescription?: string;
  currentContent?: string;
}) {
  const title = normalizeAiText(input.title) || "درس فني";
  const grade = normalizeAiText(input.grade) || "الصف المستهدف";
  const subject = normalizeAiText(input.subject) || "التربية الفنية";
  const context = normalizeAiText(input.lessonContext);
  const mode = input.mode;

  const objectives = [
    `أن يعرّف الطالب مفهوم ${title}.`,
    `أن يطبق الطالب مهارة مرتبطة بموضوع ${title} داخل نشاط عملي.`,
    "أن يقيّم الطالب العمل الفني وفق معايير واضحة وبسيطة.",
  ];

  const tools = [
    "دفتر رسم أو ورق كانسون",
    "أقلام رصاص وممحاة",
    "ألوان مناسبة للنشاط (خشبية/شمعية/مائية)",
    "أدوات مساعدة (مسطرة/فرشاة/مقص) حسب النشاط",
  ];

  const activityStepsQuick = [
    "تمهيد سريع وربط الدرس بخبرة الطالب اليومية.",
    `عرض نموذج مبسط لفكرة ${title}.`,
    "تطبيق عملي قصير فردي أو ثنائي.",
    "مناقشة النتائج وتقديم تغذية راجعة سريعة.",
  ];

  const activityStepsFull = [
    "تهيئة ذهنية: سؤال افتتاحي وملاحظة أعمال/صور مرتبطة بالدرس.",
    `شرح المفاهيم الأساسية في ${title} مع أمثلة تدريجية.`,
    "نمذجة تنفيذ النشاط خطوة بخطوة أمام الطلاب.",
    "تطبيق موجه: الطلاب ينفذون مع متابعة فردية.",
    "تطوير العمل: إضافة تحسينات فنية وإخراج نهائي.",
    "عرض الأعمال ومناقشة نقاط القوة وفرص التحسين.",
  ];

  const assessmentQuestions = [
    `ما الفكرة الرئيسية التي تعلمتها في درس ${title}؟`,
    "اذكر أداة استخدمتها ولماذا كانت مناسبة للنشاط.",
    "ما الخطوة التي حسّنت جودة عملك الفني؟",
  ];

  const rubric = [
    "الإتقان الفني: دقة التنفيذ وتنظيم العمل.",
    "تطبيق المفاهيم: توظيف عناصر الدرس بشكل صحيح.",
    "الإبداع: وجود حلول/تفاصيل شخصية في العمل.",
    "الالتزام: إنجاز النشاط ضمن الوقت والتعليمات.",
  ];

  const videoSearchHints = [
    `${subject} ${grade} ${title} شرح مبسط`,
    `${title} نشاط فني تطبيقي للطلاب`,
  ];

  const quizHints = [
    `سؤال مفاهيمي حول ${title}`,
    "سؤال تطبيق عملي على خطوات التنفيذ",
    "سؤال تقييم ذاتي لأخطاء شائعة وكيفية تصحيحها",
  ];

  const generatedDescription = mode === "quick"
    ? `درس سريع حول ${title} لطلاب ${grade} في مادة ${subject}. يركز على الفهم الأساسي والتطبيق العملي المختصر.`
    : `خطة درس متكاملة حول ${title} لطلاب ${grade} في مادة ${subject}. تتضمن تمهيدًا مشوقًا، شرحًا تدريجيًا، نشاطًا تطبيقيًا، وتقييمًا ختاميًا بمعايير واضحة.`;

  const studentSectionLines: string[] = [];
  studentSectionLines.push("## 👨‍🎓 نشاط الطالب");
  studentSectionLines.push(`### وصف النشاط\n${generatedDescription}`);
  studentSectionLines.push(`### الأدوات\n${tools.map((item) => `- ${item}`).join("\n")}`);
  studentSectionLines.push(
    `### خطوات العمل\n${(mode === "quick" ? activityStepsQuick : activityStepsFull).map((item) => `- ${item}`).join("\n")}`
  );
  studentSectionLines.push(
    `### المطلوب من الطالب\n- تنفيذ النشاط وفق الخطوات.\n- تقديم العمل النهائي بشكل منظم.\n- توضيح فكرة العمل عند العرض.`
  );
  studentSectionLines.push(
    `### ناتج التعلم المبسط\n- فهم فكرة ${title}.\n- تطبيق المهارة عمليًا بطريقة صحيحة.\n- تحسين جودة العمل الفني عبر التقييم.`
  );

  const teacherSectionLines: string[] = [];
  teacherSectionLines.push("## 👨‍🏫 دليل المعلم");
  teacherSectionLines.push(`### تمهيد الدرس\n- ربط موضوع ${title} بخبرة يومية للطالب.\n- سؤال افتتاحي يثير التفكير.`);
  teacherSectionLines.push(
    `### طريقة الشرح\n- عرض الفكرة الأساسية بشكل تدريجي.\n- نمذجة تنفيذ النشاط قبل العمل الفردي.\n- التأكد من فهم الطلاب عبر أسئلة قصيرة.`
  );
  teacherSectionLines.push(
    `### إدارة النشاط\n- تقسيم الوقت: تمهيد، تنفيذ، عرض.\n- متابعة فردية للطلاب أثناء التنفيذ.\n- دعم الطلاب المتأخرين بخطوات مبسطة.`
  );
  teacherSectionLines.push(`### أسئلة النقاش\n${assessmentQuestions.map((item) => `- ${item}`).join("\n")}`);

  if (mode === "full") {
    teacherSectionLines.push(`### التقويم\n${assessmentQuestions.map((item) => `- ${item}`).join("\n")}`);
    teacherSectionLines.push(`### Rubric\n${rubric.map((item) => `- ${item}`).join("\n")}`);
    teacherSectionLines.push(`### Video Search Hints\n${videoSearchHints.map((item) => `- ${item}`).join("\n")}`);
    teacherSectionLines.push(`### Quiz Hints\n${quizHints.map((item) => `- ${item}`).join("\n")}`);
  } else {
    teacherSectionLines.push("### التقويم\n- ملاحظة الأداء أثناء التنفيذ.\n- سؤال شفهي قصير في نهاية الحصة.");
  }

  teacherSectionLines.push(
    "### ملاحظات تنفيذ الحصة\n- ابدأ بنموذج قصير واضح.\n- قدّم تغذية راجعة بناءة أثناء العمل.\n- اختم بعرض أعمال مختارة مع تعليق إيجابي."
  );

  if (context) {
    teacherSectionLines.push(`### سياق الدرس\n${context}`);
  }

  if (normalizeAiText(input.currentContent) && mode === "full") {
    teacherSectionLines.push("### ملاحظة\nتم توليد الخطة مع مراعاة المحتوى الحالي ويمكن تعديلها قبل الحفظ.");
  }

  const content = [...studentSectionLines, "", ...teacherSectionLines].join("\n\n");

  return {
    mode,
    description: generatedDescription,
    content,
    lessonObjectives: objectives,
    requiredTools: tools,
    activitySteps: mode === "quick" ? activityStepsQuick : activityStepsFull,
    assessmentQuestions: mode === "quick" ? [] : assessmentQuestions,
    rubric: mode === "quick" ? [] : rubric,
    videoSearchHints: mode === "quick" ? [] : videoSearchHints,
    quizHints: mode === "quick" ? [] : quizHints,
  };
}

function buildTeachingGuideDraft(input: {
  title: string;
  grade?: string;
  subject?: string;
  category?: "drawing" | "decoration" | "colors" | "texture";
  lessonContext?: string;
  currentDescription?: string;
  currentContent?: string;
}) {
  const title = normalizeAiText(input.title) || "درس فني";
  const grade = normalizeAiText(input.grade) || "الصف المستهدف";
  const subject = normalizeAiText(input.subject) || "التربية الفنية";
  const context = normalizeAiText(input.lessonContext || input.currentDescription);
  const hasCurrentContent = Boolean(normalizeAiText(input.currentContent));

  const categoryHint =
    input.category === "decoration"
      ? "الزخرفة"
      : input.category === "colors"
      ? "الألوان"
      : input.category === "texture"
      ? "الملمس"
      : "الرسم";

  const lines: string[] = [];
  lines.push("### هدف الحصة للمعلم");
  lines.push(`- قيادة درس ${title} لطلاب ${grade} في ${subject} مع تركيز على ${categoryHint}.`);
  lines.push("- تحقيق ناتج واضح: فهم المفهوم + تنفيذ عملي + تقويم ختامي.");

  lines.push("### افتتاح الحصة (3-5 دقائق)");
  lines.push(`- سؤال تمهيدي: أين نلاحظ تطبيقات ${title} في أعمال فنية قريبة من حياة الطالب؟`);
  lines.push("- عرض مثال بصري سريع وطلب ملاحظة عنصر واحد مميز.");

  lines.push("### مسار الشرح");
  lines.push("- شرح الفكرة الأساسية بلغة بسيطة مع مثال مباشر.");
  lines.push("- نمذجة خطوة عملية أمام الطلاب قبل التطبيق الفردي.");
  lines.push("- أسئلة تحقق قصيرة أثناء الشرح لضمان الفهم.");

  lines.push("### إدارة التطبيق العملي");
  lines.push("- تقسيم التنفيذ إلى مراحل قصيرة مع وقت محدد لكل مرحلة.");
  lines.push("- متابعة فردية للطلاب وتقديم دعم سريع للحالات المتعثرة.");
  lines.push("- تذكير بمعايير الجودة قبل عرض الأعمال.");

  lines.push("### تقويم فوري داخل الحصة");
  lines.push(`- سؤال مفاهيمي: ما الفكرة الأساسية في ${title}؟`);
  lines.push("- سؤال تطبيقي: ما الخطوة التي حسّنت جودة العمل؟");
  lines.push("- ملاحظة أداء سريعة وفق: الإتقان، توظيف الفكرة، التنظيم.");

  lines.push("### إغلاق الحصة");
  lines.push("- عرض نموذجين من الأعمال مع تغذية راجعة بناءة.");
  lines.push("- تكليف قصير: تحسين جزء محدد في العمل بناءً على الملاحظات.");

  if (context) {
    lines.push("### سياق الدرس الحالي");
    lines.push(context);
  }

  if (hasCurrentContent) {
    lines.push("### ملاحظة دمج");
    lines.push("تم توليد هذا الدليل مع مراعاة محتوى الدرس الحالي ويمكن تعديله قبل الإدراج أو التحديث.");
  }

  return {
    title,
    draft: lines.join("\n"),
  };
}

function summarizeAiFeedback(input: {
  draftDescription?: string;
  draftContent?: string;
  finalDescription?: string;
  finalContent?: string;
}) {
  const draftDescription = normalizeAiText(input.draftDescription);
  const draftContent = normalizeAiText(input.draftContent);
  const finalDescription = normalizeAiText(input.finalDescription);
  const finalContent = normalizeAiText(input.finalContent);

  return {
    descriptionChanged: draftDescription !== finalDescription,
    contentChanged: draftContent !== finalContent,
    draftDescriptionLength: draftDescription.length,
    finalDescriptionLength: finalDescription.length,
    draftContentLength: draftContent.length,
    finalContentLength: finalContent.length,
  };
}

function normalizeCurriculumText(value: unknown): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function buildCurriculumFingerprint(parts: Array<string | number>): string {
  return createHash("sha1").update(parts.join("|")).digest("hex");
}

function detectCurriculumCategory(subject: string, domainName: string, lessonName = ""): "drawing" | "decoration" | "colors" | "texture" {
  const text = `${subject} ${domainName} ${lessonName}`;
  if (/زخرف|ornament|decora/i.test(text)) return "decoration";
  if (/لون|ألوان|shade|color/i.test(text)) return "colors";
  if (/ملمس|texture/i.test(text)) return "texture";
  return "drawing";
}

async function runAutoCurriculumBuilder(params: {
  database: any;
  preview: any;
  importJobId: number;
  createdBy: number;
  sourceFileName: string;
}) {
  const { database, preview, importJobId, createdBy, sourceFileName } = params;
  const sourceKey = String(preview?.meta?.sourceKey || `import-job-${importJobId}`);

  const sourceRows = await database
    .select()
    .from(contentSourceRecords)
    .where(eq(contentSourceRecords.importJobId, importJobId));

  const pathRows = sourceRows.filter((row: any) => row.entityType === "path");
  const lessonRows = sourceRows.filter((row: any) => row.entityType === "lesson");
  const challengeRows = sourceRows.filter((row: any) => row.entityType === "challenge");
  const quizRows = sourceRows.filter((row: any) => row.entityType === "quiz");

  const pathByKey = new Map<string, number>();
  for (const row of pathRows) {
    const key = `${normalizeCurriculumText(row.normalizedTitle)}|${Number(row.pageFrom || 0)}|${Number(row.pageTo || 0)}`;
    pathByKey.set(key, Number(row.entityId));
  }

  const lessonByKey = new Map<string, { lessonId: number; row: any }>();
  for (const row of lessonRows) {
    const key = `${normalizeCurriculumText(row.normalizedTitle)}|${Number(row.pageFrom || 0)}|${Number(row.pageTo || 0)}`;
    lessonByKey.set(key, { lessonId: Number(row.entityId), row });
  }

  const challengeFingerprints = new Set(challengeRows.map((row: any) => String(row.sourceFingerprint || "")));
  const quizFingerprints = new Set(quizRows.map((row: any) => String(row.sourceFingerprint || "")));

  const stats = {
    pathsCreated: 0,
    lessonsObjectiveUpdated: 0,
    challengesCreated: 0,
    quizzesCreated: 0,
  };

  const now = new Date();
  const challengeEnd = new Date(now);
  challengeEnd.setDate(challengeEnd.getDate() + 30);

  for (const term of preview?.outline?.terms || []) {
    for (const domain of term?.domains || []) {
      if (domain?.ignored) continue;

      const domainKey = `${normalizeCurriculumText(domain?.name)}|${Number(domain?.pageFrom || 0)}|${Number(domain?.pageTo || 0)}`;
      let pathId = pathByKey.get(domainKey) || null;

      if (!pathId) {
        const insertId = await db.createLearningPath({
          title: String(domain?.name || "مسار مستورد"),
          description: `مستورد تلقائياً من PDF (${String(term?.name || "")}) - ${String(preview?.meta?.fileName || sourceFileName)}`,
          teacherId: createdBy,
          grade: String(preview?.meta?.grade || ""),
          category: detectCurriculumCategory(String(preview?.meta?.subject || ""), String(domain?.name || "")),
          isVisible: true,
          order: 0,
        } as any);

        pathId = Number(insertId || 0);
        if (pathId) {
          const normalizedDomain = normalizeCurriculumText(domain?.name);
          const sourceFingerprint = buildCurriculumFingerprint([
            "path",
            sourceKey,
            normalizeCurriculumText(term?.name),
            normalizedDomain,
            Number(domain?.pageFrom || 0),
            Number(domain?.pageTo || 0),
          ]);

          await database.insert(contentSourceRecords).values({
            importJobId,
            entityType: "path",
            entityId: pathId,
            sourceType: "pdf",
            sourceKey,
            sourceFileName,
            sourceFingerprint,
            normalizedTitle: normalizedDomain,
            pageFrom: Number(domain?.pageFrom || 0) || null,
            pageTo: Number(domain?.pageTo || 0) || null,
            extractionMode: preview?.mode === "structured" ? "structured" : "fallback_split",
            confidence: Math.round(Number(domain?.confidence || 0) * 100) || null,
            metadata: JSON.stringify({
              sourceType: "pdf",
              importJobId,
              createdByPipeline: false,
              builder: "auto_curriculum_builder",
              term: String(term?.name || ""),
            }),
          });

          pathByKey.set(domainKey, pathId);
          stats.pathsCreated += 1;
        }
      }

      for (const unit of domain?.units || []) {
        for (const lesson of unit?.lessons || []) {
          if (lesson?.ignored) continue;

          const lessonKey = `${normalizeCurriculumText(lesson?.name)}|${Number(lesson?.pageFrom || 0)}|${Number(lesson?.pageTo || 0)}`;
          const lessonRef = lessonByKey.get(lessonKey);
          if (!lessonRef?.lessonId) continue;

          const lessonId = Number(lessonRef.lessonId);
          const objectiveNames: string[] = [];

          for (const activity of lesson?.activities || []) {
            if (!activity?.ignored && String(activity?.name || "").trim()) {
              objectiveNames.push(String(activity.name).trim());
            }
          }
          for (const assessment of lesson?.assessments || []) {
            if (!assessment?.ignored && String(assessment?.name || "").trim()) {
              objectiveNames.push(`تقويم: ${String(assessment.name).trim()}`);
            }
          }

          const objectiveLines = objectiveNames.slice(0, 8).map((name) => `- ${name}`);
          const objectiveBlock = [
            "[AUTO_OBJECTIVES]",
            `الوحدة: ${String(unit?.name || "")}`,
            `الهدف العام: إتقان ${String(lesson?.name || "")}`,
            ...(objectiveLines.length > 0 ? ["أهداف تفصيلية:", ...objectiveLines] : []),
          ].join("\n");

          const currentLessonRows = await database.select().from(lessons).where(eq(lessons.id, lessonId)).limit(1);
          const currentLesson = currentLessonRows[0];
          if (currentLesson) {
            const currentContent = String(currentLesson.content || "");
            if (!currentContent.includes("[AUTO_OBJECTIVES]")) {
              await db.updateLesson(lessonId, {
                description: currentLesson.description || `مستورد تلقائياً من PDF - ${String(domain?.name || "")}${String(unit?.name || "") ? ` / ${String(unit?.name)}` : ""}`,
                content: `${currentContent}\n\n${objectiveBlock}`.trim(),
              });
              stats.lessonsObjectiveUpdated += 1;
            }
          }

          for (const activity of lesson?.activities || []) {
            if (activity?.ignored) continue;

            const activityName = String(activity?.name || "").trim();
            if (!activityName) continue;

            const challengeFingerprint = buildCurriculumFingerprint([
              "challenge",
              sourceKey,
              normalizeCurriculumText(lesson?.name),
              Number(lesson?.pageFrom || 0),
              Number(lesson?.pageTo || 0),
              normalizeCurriculumText(activityName),
            ]);
            if (challengeFingerprints.has(challengeFingerprint)) continue;

            const insertRes = await db.createChallengeNew({
              title: `مسودة نشاط: ${activityName}`,
              description: `مسودة نشاط مستخرجة تلقائياً من الدرس: ${String(lesson?.name || "")}.`,
              lessonId,
              grade: String(preview?.meta?.grade || ""),
              isVisible: false,
              startDate: now,
              endDate: challengeEnd,
              difficulty: "medium",
              points: 10,
              targetGender: "all",
              teacherId: createdBy,
              termLabelRaw: String(term?.name || ""),
              subjectLabelRaw: String(preview?.meta?.subject || "التربية الفنية"),
            });

            const challengeId = Number((insertRes as any)?.[0]?.insertId || (insertRes as any)?.insertId || 0);
            if (!challengeId) continue;

            await database.insert(contentSourceRecords).values({
              importJobId,
              entityType: "challenge",
              entityId: challengeId,
              sourceType: "pdf",
              sourceKey,
              sourceFileName,
              sourceFingerprint: challengeFingerprint,
              normalizedTitle: normalizeCurriculumText(activityName),
              pageFrom: Number(activity?.pageFrom || lesson?.pageFrom || 0) || null,
              pageTo: Number(activity?.pageTo || lesson?.pageTo || 0) || null,
              extractionMode: preview?.mode === "structured" ? "structured" : "fallback_split",
              confidence: Math.round(Number(activity?.confidence || 0) * 100) || null,
              metadata: JSON.stringify({
                sourceType: "pdf",
                importJobId,
                createdByPipeline: false,
                builder: "auto_curriculum_builder",
                lessonId,
                lessonTitle: String(lesson?.name || ""),
                domain: String(domain?.name || ""),
                unit: String(unit?.name || ""),
              }),
            });

            challengeFingerprints.add(challengeFingerprint);
            stats.challengesCreated += 1;
          }

          for (const assessment of lesson?.assessments || []) {
            if (assessment?.ignored) continue;

            const assessmentName = String(assessment?.name || "").trim();
            if (!assessmentName) continue;

            const quizFingerprint = buildCurriculumFingerprint([
              "quiz",
              sourceKey,
              normalizeCurriculumText(lesson?.name),
              Number(lesson?.pageFrom || 0),
              Number(lesson?.pageTo || 0),
              normalizeCurriculumText(assessmentName),
            ]);
            if (quizFingerprints.has(quizFingerprint)) continue;

            const generated = await generateQuizQuestionsFromLesson({
              database,
              lessonId,
            });
            if (!generated.ok) {
              continue;
            }

            const insertRes = await db.createQuizNew({
              lessonId,
              title: `تقويم: ${assessmentName}`,
              description: markQuizSource("تقويم مُنشأ تلقائياً من محتوى الدرس بعد اعتماد الاستيراد.", "imported"),
              questions: JSON.stringify(generated.questions),
              passingScore: 60,
              termLabelRaw: String(term?.name || ""),
              subjectLabelRaw: String(preview?.meta?.subject || "التربية الفنية"),
            });

            const quizId = Number((insertRes as any)?.[0]?.insertId || (insertRes as any)?.insertId || 0);
            if (!quizId) continue;

            await database.insert(contentSourceRecords).values({
              importJobId,
              entityType: "quiz",
              entityId: quizId,
              sourceType: "pdf",
              sourceKey,
              sourceFileName,
              sourceFingerprint: quizFingerprint,
              normalizedTitle: normalizeCurriculumText(assessmentName),
              pageFrom: Number(assessment?.pageFrom || lesson?.pageFrom || 0) || null,
              pageTo: Number(assessment?.pageTo || lesson?.pageTo || 0) || null,
              extractionMode: preview?.mode === "structured" ? "structured" : "fallback_split",
              confidence: Math.round(Number(assessment?.confidence || 0) * 100) || null,
              metadata: JSON.stringify({
                sourceType: "pdf",
                importJobId,
                createdByPipeline: false,
                builder: "auto_curriculum_builder",
                lessonId,
                lessonTitle: String(lesson?.name || ""),
                domain: String(domain?.name || ""),
                unit: String(unit?.name || ""),
                draft: false,
                sourceSummary: generated.sourceSummary,
              }),
            });

            quizFingerprints.add(quizFingerprint);
            stats.quizzesCreated += 1;
          }
        }
      }
    }
  }

  return stats;
}

const DEFAULT_ABOUT_SETTINGS = {
  heroTitle: "عن منصة التربية الفنية التفاعلية",
  heroDescription:
    "منصة تعليمية مبتكرة تجمع بين التكنولوجيا والفن لتقديم تجربة تعليمية فريدة متوافقة مع منهج التربية الفنية في المملكة العربية السعودية",
  mediaType: "image" as const,
  mediaUrl: "",
  mediaTitle: "شاهد كيف تعمل المنصة",
  mediaDescription: "يمكنك إضافة صورة أو فيديو تعريفي من لوحة الإدارة",
};

const DEFAULT_SITE_GALLERY_SETTINGS = {
  id: 1,
  heroTitle: "معرض الإبداع الفني",
  heroDescription: "اكتشف إبداعات طلابنا المبدعين من مختلف المدارس والمراحل الدراسية.",
  heroBadge: "منصة تعرض الإبداع المدرسي المنشور",
  heroImageUrl: "",
  categories: ["all", "drawing", "ornaments", "textile", "pottery", "printmaking", "crafts", "digital", "other", "most-voted"],
  emptyTitle: "لا توجد أعمال مطابقة للبحث أو التصنيف",
  emptyDescription: "جرّب تغيير كلمات البحث أو العودة إلى تصنيف الكل.",
  imageErrorTitle: "تعذر عرض الصورة",
  imageErrorDescription: "لا نعرض مساحة فارغة. يمكنك إعادة المحاولة أو فتح تفاصيل العمل.",
  slideshowEnabled: true,
  slideshowIntervalSeconds: 5,
  slideshowShowDetails: false,
  updatedAt: null as string | null,
};

const GALLERY_VISIBILITY_VALUES = ["private", "unlisted", "public"] as const;
type GalleryVisibility = (typeof GALLERY_VISIBILITY_VALUES)[number];

function normalizeGalleryVisibility(value: unknown, fallback: GalleryVisibility = "private"): GalleryVisibility {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "public") return "public";
  if (normalized === "unlisted") return "unlisted";
  if (normalized === "private") return "private";
  return fallback;
}

function buildRandomShareSlug(prefix: string): string {
  const token = createHash("sha256")
    .update(`${prefix}-${Date.now()}-${Math.random()}`)
    .digest("hex")
    .slice(0, 24);
  return `${prefix}-${token}`;
}

function extractFirstName(value: string | null | undefined): string {
  const normalized = String(value || "").trim();
  if (!normalized) return "طالب";
  return normalized.split(/\s+/).filter(Boolean)[0] || "طالب";
}

function isGalleryPubliclyAccessible(input: {
  enabled: boolean;
  visibility: GalleryVisibility;
  shareEnabled: boolean;
  allowPublicViewing: boolean;
}): boolean {
  if (!input.enabled) return false;
  if (!input.allowPublicViewing) return false;
  if (input.visibility === "public") return true;
  if (input.visibility === "unlisted" && input.shareEnabled) return true;
  return false;
}

function normalizeSlideshowIntervalSeconds(value: unknown, fallback = 5): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const rounded = Math.round(parsed);
  return Math.max(3, Math.min(15, rounded));
}

function buildDefaultTeacherGallerySettings(teacherName?: string | null) {
  const name = String(teacherName || "").trim();
  return {
    enabled: true,
    heroTitle: name ? `معرض المعلم ${name}` : "معرض المعلم العام",
    heroDescription: "معرض عام يعرض الأعمال التي اختار المعلم إظهارها ضمن هويته الفنية.",
    headerImageUrl: "",
    featuredArtworkIds: [] as number[],
    imageErrorTitle: "تعذر عرض الصورة",
    imageErrorDescription: "لا نعرض مساحة فارغة. يمكنك إعادة المحاولة أو فتح تفاصيل العمل.",
    visibility: "private" as GalleryVisibility,
    shareSlug: "",
    shareEnabled: false,
    showArtistName: true,
    allowPublicViewing: false,
    slideshowEnabled: true,
    slideshowIntervalSeconds: 5,
    slideshowShowDetails: false,
  };
}

function buildDefaultClassGallerySettings(className?: string | null) {
  const name = String(className || "").trim();
  return {
    enabled: true,
    heroTitle: name ? `معرض فصل ${name}` : "معرض الفصل",
    heroDescription: "واجهة عرض بصرية لأعمال الفصل المعتمدة للعرض.",
    headerImageUrl: "",
    featuredArtworkIds: [] as number[],
    imageErrorTitle: "تعذر عرض الصورة",
    imageErrorDescription: "لا نعرض مساحة فارغة. يمكنك إعادة المحاولة أو فتح تفاصيل العمل.",
    visibility: "private" as GalleryVisibility,
    shareSlug: "",
    shareEnabled: false,
    showStudentNames: true,
    showArtistName: true,
    allowPublicViewing: false,
    slideshowEnabled: true,
    slideshowIntervalSeconds: 5,
    slideshowShowDetails: false,
  };
}

function buildDefaultStudentGallerySettings(input: {
  studentId: number;
  teacherId: number;
  classId: number | null;
}) {
  return {
    studentId: input.studentId,
    teacherId: input.teacherId,
    classId: input.classId,
    visibility: "unlisted" as GalleryVisibility,
    shareSlug: "",
    shareEnabled: true,
    showStudentName: false,
    showFirstNameOnly: true,
    showClassName: false,
    showSchoolName: false,
    showBadges: true,
    showCertificates: false,
    showVotes: false,
    allowPublicViewing: true,
  };
}

function normalizeTeacherCompetitionStatus(value: unknown, fallback: TeacherCompetitionStatus = "draft"): TeacherCompetitionStatus {
  const normalized = String(value || "").trim();
  if (normalized === "draft" || normalized === "active" || normalized === "closed" || normalized === "published") return normalized;
  return fallback;
}

function normalizeCompetitionSubmissionStatus(value: unknown, fallback: CompetitionSubmissionStatus = "pending"): CompetitionSubmissionStatus {
  const normalized = String(value || "").trim();
  if (normalized === "pending" || normalized === "approved" || normalized === "rejected" || normalized === "winner" || normalized === "featured") return normalized;
  return fallback;
}

function normalizeCompetitionAwardRank(value: unknown): CompetitionAwardRank {
  const normalized = String(value || "").trim();
  if (normalized === "first" || normalized === "second" || normalized === "third") return normalized;
  return null;
}

function publicSubmissionWhere() {
  return or(
    eq(competitionSubmissions.status, "approved"),
    eq(competitionSubmissions.status, "winner"),
    eq(competitionSubmissions.status, "featured"),
  );
}

async function uploadCompetitionImage(database: any, input: { imageData: string; fileName?: string; mimeType?: string; scope: string; sourceType: string }) {
  const mimeType = String(input.mimeType || "image/png").trim();
  if (!mimeType.startsWith("image/")) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "نوع الملف غير مدعوم" });
  }

  const cleanedBase64 = input.imageData.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, "");
  const buffer = Buffer.from(cleanedBase64, "base64");
  if (!buffer.length) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "بيانات الصورة غير صالحة" });
  }
  if (buffer.length > 8 * 1024 * 1024) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "حجم الصورة يجب ألا يتجاوز 8MB" });
  }

  const extension = mimeType.split("/")[1] || "png";
  const safeName = String(input.fileName || "image")
    .replace(/\.[^/.]+$/, "")
    .replace(/[^a-zA-Z0-9-_]/g, "-")
    .slice(0, 64);
  const uploaded = await storagePut(`competitions/${input.scope}/${Date.now()}-${safeName}.${extension}`, buffer, mimeType);

  await registerInternalAsset(database, {
    provider: "spaces",
    bucket: uploaded.bucket,
    objectKey: uploaded.key,
    publicUrl: uploaded.url,
    mimeType,
    fileSize: buffer.length,
    sourceType: input.sourceType,
    ownershipContext: "teacher_competition",
  });

  return uploaded;
}

function parseStringArrayJson(input: string | null | undefined, fallback: string[]): string[] {
  try {
    const parsed = JSON.parse(String(input || "[]"));
    if (!Array.isArray(parsed)) return fallback;
    const values = parsed.map((entry) => String(entry || "").trim()).filter((entry) => entry.length > 0);
    return values.length > 0 ? values : fallback;
  } catch {
    return fallback;
  }
}

function parseNumberArrayJson(input: string | null | undefined): number[] {
  try {
    const parsed = JSON.parse(String(input || "[]"));
    if (!Array.isArray(parsed)) return [];
    const values = parsed.map((entry) => Number(entry)).filter((entry) => Number.isFinite(entry) && entry > 0);
    return Array.from(new Set(values));
  } catch {
    return [];
  }
}

async function getLatestStudentClassMembership(database: any, studentId: number) {
  const rows = await database
    .select({
      studentId: classStudents.studentId,
      classId: classStudents.classId,
      className: classes.name,
      teacherId: classes.teacherId,
      studentName: users.name,
      joinedAt: classStudents.joinedAt,
    })
    .from(classStudents)
    .innerJoin(classes, eq(classStudents.classId, classes.id))
    .leftJoin(users, eq(classStudents.studentId, users.id))
    .where(eq(classStudents.studentId, studentId))
    .orderBy(desc(classStudents.joinedAt))
    .limit(1);

  return rows[0] || null;
}

async function syncLessonAssetReferences(
  database: any,
  lessonId: number,
  input: {
    videoUrl?: string | null;
    imageUrl?: string | null;
    pdfUrl?: string | null;
  }
) {
  if (Object.prototype.hasOwnProperty.call(input, "videoUrl")) {
    await replaceEntityAssetReferenceByUrl(database, {
      entityType: "lessons",
      entityId: lessonId,
      fieldName: "videoUrl",
      publicUrl: input.videoUrl,
      sourceType: "lesson_video",
      ownershipContext: `lesson:${lessonId}`,
    });
  }

  if (Object.prototype.hasOwnProperty.call(input, "imageUrl")) {
    await replaceEntityAssetReferenceByUrl(database, {
      entityType: "lessons",
      entityId: lessonId,
      fieldName: "imageUrl",
      publicUrl: input.imageUrl,
      sourceType: "lesson_image",
      ownershipContext: `lesson:${lessonId}`,
    });
  }

  if (Object.prototype.hasOwnProperty.call(input, "pdfUrl")) {
    await replaceEntityAssetReferenceByUrl(database, {
      entityType: "lessons",
      entityId: lessonId,
      fieldName: "pdfUrl",
      publicUrl: input.pdfUrl,
      sourceType: "lesson_pdf",
      ownershipContext: `lesson:${lessonId}`,
    });
  }
}

async function syncAboutMediaReference(database: any, settingId: number, mediaUrl: string) {
  await replaceEntityAssetReferenceByUrl(database, {
    entityType: "aboutPageSettings",
    entityId: settingId,
    fieldName: "mediaUrl",
    publicUrl: mediaUrl,
    sourceType: "about_media",
    ownershipContext: `about:${settingId}`,
  });
}

function normalizeArtworkImageUrl(value: string | null | undefined): string {
  const text = String(value || "").trim();
  if (!text) return "";

  if (/^data:image\//i.test(text)) return text;
  if (text.startsWith("//")) return `https:${text}`;
  if (/^https:\/\//i.test(text)) return text;
  if (/^http:\/\//i.test(text)) return text.replace(/^http:\/\//i, "https://");
  if (text.startsWith("/")) return text;

  // Legacy rows may store only object keys.
  return text;
}

function isKeyOnlyImageUrl(value: string): boolean {
  if (!value) return false;
  if (/^https?:\/\//i.test(value)) return false;
  if (/^data:image\//i.test(value)) return false;
  if (value.startsWith("/")) return false;
  return true;
}

async function resolveArtworkImageUrl(value: string | null | undefined, key: string | null | undefined): Promise<string> {
  const normalized = normalizeArtworkImageUrl(value);

  if (normalized && !isKeyOnlyImageUrl(normalized)) {
    return normalized;
  }

  const keyCandidates = Array.from(
    new Set(
      [String(key || "").trim(), String(normalized || "").trim()].filter(Boolean),
    ),
  );

  for (const candidate of keyCandidates) {
    try {
      const resolved = await storageGet(candidate);
      const publicUrl = normalizeArtworkImageUrl(resolved?.url || "");
      if (publicUrl && !isKeyOnlyImageUrl(publicUrl)) {
        return publicUrl;
      }
    } catch {
      // Keep trying remaining candidates.
    }
  }

  return normalized;
}

export const appRouter = router({
  system: systemRouter,
  
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
    updateRole: protectedProcedure
      .input(z.object({ role: z.enum(["teacher", "student"]) }))
      .mutation(async ({ ctx, input }) => {
        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        if (ctx.user.role !== "user") {
          throw new TRPCError({ code: "FORBIDDEN", message: "لا يمكن تغيير الدور لهذا الحساب" });
        }

        if (input.role === "teacher") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "تفعيل دور المعلم يتم فقط بعد طلب تسجيل وموافقة الإدارة",
          });
        }

        const studentMembership = await database
          .select({ id: classStudents.id })
          .from(classStudents)
          .where(eq(classStudents.studentId, ctx.user.id))
          .limit(1);

        if (!studentMembership[0]) {
          throw new TRPCError({ code: "FORBIDDEN", message: "هذا الحساب غير مضاف كطالب" });
        }

        // تحديث دور المستخدم
        await database.update(users)
          .set({ role: input.role })
          .where(eq(users.id, ctx.user.id));

        return { success: true };
      }),
  }),

  about: router({
    getSettings: publicProcedure.query(async () => {
      const database = await getDb();
      if (!database) {
        return DEFAULT_ABOUT_SETTINGS;
      }

      try {
        const rows = await database.select().from(aboutPageSettings).orderBy(desc(aboutPageSettings.id)).limit(1);
        if (!rows[0]) {
          return DEFAULT_ABOUT_SETTINGS;
        }

        return {
          heroTitle: rows[0].heroTitle,
          heroDescription: rows[0].heroDescription,
          mediaType: rows[0].mediaType || "video",
          mediaUrl: rows[0].mediaUrl,
          mediaTitle: rows[0].mediaTitle,
          mediaDescription: rows[0].mediaDescription || "",
        };
      } catch {
        return DEFAULT_ABOUT_SETTINGS;
      }
    }),
  }),

  showcase: router({
    getSettings: publicProcedure.query(async () => {
      const database = await getDb();
      if (!database) {
        return cloneShowcaseSettings(DEFAULT_SHOWCASE_SETTINGS);
      }

      try {
        const rows = await database
          .select()
          .from(showcaseSettings)
          .where(eq(showcaseSettings.id, 1))
          .limit(1);

        if (!rows[0]) {
          return cloneShowcaseSettings(DEFAULT_SHOWCASE_SETTINGS);
        }

        return normalizeShowcaseSettings(rows[0]);
      } catch {
        return cloneShowcaseSettings(DEFAULT_SHOWCASE_SETTINGS);
      }
    }),
  }),

  // إدارة الفصول
  classes: router({
    // الحصول على فصول المستخدم (معلم/طالب/إدارة)
    getMyClasses: protectedProcedure.query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) return [];

      if (ctx.user.role === "admin") {
        return db.select().from(classes).orderBy(desc(classes.createdAt));
      }

      if (ctx.user.role === "teacher") {
        return db
          .select()
          .from(classes)
          .where(eq(classes.teacherId, ctx.user.id))
          .orderBy(desc(classes.createdAt));
      }

      const studentClassIds = await db
        .select({ classId: classStudents.classId })
        .from(classStudents)
        .where(eq(classStudents.studentId, ctx.user.id));

      if (studentClassIds.length === 0) return [];

      const classIds = studentClassIds.map((item) => item.classId);
      return db
        .select()
        .from(classes)
        .where(sql`${classes.id} IN (${classIds.join(",")})`)
        .orderBy(desc(classes.createdAt));
    }),

    // إنشاء فصل جديد
    create: protectedProcedure
      .input(z.object({
        name: z.string().min(1),
        grade: z.string().min(1),
        description: z.string().optional(),
        classGender: z.enum(["boys", "girls"]).optional(),
        studentContentTermVisibility: z.enum(["all", "first", "second"]).default("all"),
      }))
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        // توليد رمز فريد للفصل (6 أحرف وأرقام)
        const classCode = Math.random().toString(36).substring(2, 8).toUpperCase();

        const result = await db.insert(classes).values({
          name: input.name,
          grade: input.grade,
          description: input.description,
          classGender: input.classGender,
          studentContentTermVisibility: input.studentContentTermVisibility,
          teacherId: ctx.user.id,
          classCode,
        });

        return { success: true, classCode };
      }),

    // تعديل فصل
    update: protectedProcedure
      .input(z.object({
        classId: z.number(),
        name: z.string().min(1),
        grade: z.string().min(1),
        description: z.string().optional(),
        classGender: z.enum(["boys", "girls"]).nullable().optional(),
        studentContentTermVisibility: z.enum(["all", "first", "second"]).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const classData = await db.select().from(classes)
          .where(eq(classes.id, input.classId))
          .limit(1);

        if (!classData[0]) {
          throw new TRPCError({ code: "NOT_FOUND", message: "الفصل غير موجود" });
        }

        const canEdit = classData[0].teacherId === ctx.user.id || ctx.user.role === "admin";
        if (!canEdit) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }

        await db.update(classes)
          .set({
            name: input.name,
            grade: input.grade,
            description: input.description,
            classGender: input.classGender === undefined ? classData[0].classGender : input.classGender,
            studentContentTermVisibility:
              input.studentContentTermVisibility === undefined
                ? normalizeFixedTermVisibility(classData[0].studentContentTermVisibility)
                : input.studentContentTermVisibility,
          })
          .where(eq(classes.id, input.classId));

        return { success: true };
      }),

    // الحصول على تفاصيل فصل
    getById: protectedProcedure
      .input(z.object({ classId: z.number() }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) return null;

        const result = await db.select().from(classes)
          .where(eq(classes.id, input.classId))
          .limit(1);

        return result[0] || null;
      }),

    // حذف فصل
    delete: protectedProcedure
      .input(z.object({ classId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        // التحقق من ملكية الفصل
        const classData = await db.select().from(classes)
          .where(eq(classes.id, input.classId))
          .limit(1);

        if (!classData[0] || classData[0].teacherId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }

        await db.delete(classes).where(eq(classes.id, input.classId));
        return { success: true };
      }),

    // الحصول على طلاب الفصل
    getStudents: protectedProcedure
      .input(z.object({ classId: z.number() }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) return [];

        return db.select().from(classStudents)
          .where(eq(classStudents.classId, input.classId))
          .orderBy(classStudents.studentName);
      }),

    // إضافة طالب للفصل
    addStudent: protectedProcedure
      .input(z.object({ 
        classId: z.number(),
        studentName: z.string(),
        password: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "teacher" && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN" });
        }

        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        // توليد رقم سري عشوائي إذا لم يتم توفيره
        const password = input.password || Math.random().toString(36).substring(2, 8).toUpperCase();

        // إنشاء مستخدم جديد للطالب
        const [newUser] = await db.insert(users).values({
          openId: `student_${Date.now()}_${Math.random().toString(36).substring(7)}`,
          name: input.studentName,
          role: "student",
        });

        const studentId = Number(newUser.insertId);

        await db.insert(classStudents).values({
          classId: input.classId,
          studentId,
          studentName: input.studentName,
          password,
        });

        return { success: true, password };
      }),

    // إضافة عدة طلاب دفعة واحدة
    addMultipleStudents: protectedProcedure
      .input(z.object({ 
        classId: z.number(),
        studentNames: z.array(z.string()),
      }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "teacher" && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN" });
        }

        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const results = [];

        for (const studentName of input.studentNames) {
          if (!studentName.trim()) continue;

          // توليد رقم سري عشوائي
          const password = Math.random().toString(36).substring(2, 8).toUpperCase();

          // إنشاء مستخدم جديد للطالب
          const [newUser] = await db.insert(users).values({
            openId: `student_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            name: studentName.trim(),
            role: "student",
          });

          const studentId = Number(newUser.insertId);

          await db.insert(classStudents).values({
            classId: input.classId,
            studentId,
            studentName: studentName.trim(),
            password,
          });

          results.push({ name: studentName.trim(), password });
        }

        return { success: true, students: results };
      }),

    // حذف طالب من الفصل
    removeStudent: protectedProcedure
      .input(z.object({ 
        classId: z.number(),
        studentId: z.number()
      }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "teacher" && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN" });
        }

        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        await db.delete(classStudents)
          .where(
            sql`${classStudents.classId} = ${input.classId} AND ${classStudents.studentId} = ${input.studentId}`
          );

        return { success: true };
      }),

    // نقل طالب من فصل إلى فصل آخر دون حذف بياناته
    transferStudent: protectedProcedure
      .input(z.object({
        fromClassId: z.number(),
        toClassId: z.number(),
        studentId: z.number(),
      }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "teacher" && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN" });
        }

        if (input.fromClassId === input.toClassId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "الفصل الحالي هو نفسه الفصل الهدف" });
        }

        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const fromClassRows = await db.select().from(classes)
          .where(eq(classes.id, input.fromClassId))
          .limit(1);

        const toClassRows = await db.select().from(classes)
          .where(eq(classes.id, input.toClassId))
          .limit(1);

        const fromClass = fromClassRows[0];
        const toClass = toClassRows[0];

        if (!fromClass || !toClass) {
          throw new TRPCError({ code: "NOT_FOUND", message: "أحد الفصول غير موجود" });
        }

        if (ctx.user.role !== "admin") {
          const canManageBoth = fromClass.teacherId === ctx.user.id && toClass.teacherId === ctx.user.id;
          if (!canManageBoth) {
            throw new TRPCError({ code: "FORBIDDEN", message: "لا تملك صلاحية النقل بين هذين الفصلين" });
          }
        }

        const currentMembership = await db.select().from(classStudents)
          .where(and(
            eq(classStudents.classId, input.fromClassId),
            eq(classStudents.studentId, input.studentId)
          ))
          .limit(1);

        if (!currentMembership[0]) {
          throw new TRPCError({ code: "NOT_FOUND", message: "الطالب غير موجود في الفصل الحالي" });
        }

        const alreadyInTarget = await db.select().from(classStudents)
          .where(and(
            eq(classStudents.classId, input.toClassId),
            eq(classStudents.studentId, input.studentId)
          ))
          .limit(1);

        if (alreadyInTarget[0]) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "الطالب موجود بالفعل في الفصل الهدف" });
        }

        await db.update(classStudents)
          .set({ classId: input.toClassId })
          .where(and(
            eq(classStudents.classId, input.fromClassId),
            eq(classStudents.studentId, input.studentId)
          ));

        return { success: true };
      }),

    // الحصول على فصل برمزه
    getByCode: publicProcedure
      .input(z.object({ classCode: z.string() }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) return null;

        const result = await db.select().from(classes)
          .where(eq(classes.classCode, input.classCode))
          .limit(1);

        return result[0] || null;
      }),

    // الحصول على فصول الطالب
    getStudentClasses: protectedProcedure.query(async ({ ctx }) => {
      const database = await getDb();
      if (!database) return [];

      // الحصول على معرفات الفصول التي ينتمي إليها الطالب
      const studentClassIds = await database
        .select({ classId: classStudents.classId })
        .from(classStudents)
        .where(eq(classStudents.studentId, ctx.user.id));

      if (studentClassIds.length === 0) return [];

      // الحصول على تفاصيل الفصول
      const classIds = studentClassIds.map(sc => sc.classId);
      return database
        .select()
        .from(classes)
        .where(sql`${classes.id} IN (${classIds.join(',')})`)
        .orderBy(desc(classes.createdAt));
    }),

    // الانضمام للفصل عبر الرابط
    joinClass: protectedProcedure
      .input(z.object({ 
        classCode: z.string(),
        password: z.string(),
      }))
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        // الحصول على الفصل
        const classData = await db.select().from(classes)
          .where(eq(classes.classCode, input.classCode))
          .limit(1);

        if (!classData[0]) {
          throw new TRPCError({ code: "NOT_FOUND", message: "رمز الفصل غير صحيح" });
        }

        // التحقق من عدم وجود الطالب في الفصل
        const existing = await db.select().from(classStudents)
          .where(
            sql`${classStudents.classId} = ${classData[0].id} AND ${classStudents.studentId} = ${ctx.user.id}`
          )
          .limit(1);

        if (existing[0]) {
          return { success: true, alreadyJoined: true };
        }

        const passwordRecord = await db
          .select({ id: classStudents.id })
          .from(classStudents)
          .where(
            and(
              eq(classStudents.classId, classData[0].id),
              eq(classStudents.password, input.password)
            )
          )
          .limit(1);

        if (!passwordRecord[0]) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "رمز دخول الطالب غير صحيح" });
        }

        // إضافة الطالب للفصل
        await db.insert(classStudents).values({
          classId: classData[0].id,
          studentId: ctx.user.id,
          studentName: ctx.user.name || "طالب",
          password: input.password,
        });

        return { success: true, alreadyJoined: false };
      }),
  }),

  // إدارة الأعمال الفنية
  artworks: router({
    // الحصول على أعمال الطالب
    getMyArtworks: protectedProcedure.query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) return [];

      const rows = await db
        .select({
          ...getTableColumns(artworks),
          challengeId: sql<number | null>`(
            select cs.challengeId
            from challengeSubmissions cs
            where cs.artworkId = artworks.id
            order by cs.submittedAt desc
            limit 1
          )`,
          challengeTitle: sql<string | null>`(
            select c.title
            from challengeSubmissions cs
            left join challenges c on c.id = cs.challengeId
            where cs.artworkId = artworks.id
            order by cs.submittedAt desc
            limit 1
          )`,
          submissionStatus: sql<"pending" | "approved" | "rejected" | null>`(
            select cs.status
            from challengeSubmissions cs
            where cs.artworkId = artworks.id
            order by cs.submittedAt desc
            limit 1
          )`,
          latestTeacherComment: sql<string | null>`(
            select r.comment
            from reviews r
            where r.artworkId = artworks.id
              and r.comment is not null
            order by r.createdAt desc
            limit 1
          )`,
          latestTeacherRating: sql<number | null>`(
            select r.rating
            from reviews r
            where r.artworkId = artworks.id
              and r.rating is not null
            order by r.createdAt desc
            limit 1
          )`,
          competitionPlace: sql<CompetitionPlace>`(
            case
              when artworks.competitionId is null then null
              when artworks.id = (
                select c.firstPlaceArtworkId
                from competitions c
                where c.id = artworks.competitionId
                limit 1
              ) then 'first'
              when artworks.id = (
                select c.secondPlaceArtworkId
                from competitions c
                where c.id = artworks.competitionId
                limit 1
              ) then 'second'
              when artworks.id = (
                select c.thirdPlaceArtworkId
                from competitions c
                where c.id = artworks.competitionId
                limit 1
              ) then 'third'
              else null
            end
          )`,
        })
        .from(artworks)
        .where(eq(artworks.studentId, ctx.user.id))
        .orderBy(desc(artworks.createdAt));

      const normalizedRows = await Promise.all(
        rows.map(async (row: any) => ({
          ...row,
          imageUrl: await resolveArtworkImageUrl(row.imageUrl, row.imageKey),
        })),
      );

      return normalizedRows;
    }),

    getArtistProfile: protectedProcedure
      .input(
        z.object({
          studentId: z.number(),
        })
      )
      .query(async ({ ctx, input }) => {
        const database = await getDb();
        if (!database) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "تعذر الاتصال بقاعدة البيانات" });
        }

        if (ctx.user.role === "student" || ctx.user.role === "user") {
          const classRows = await database
            .select({ teacherId: classes.teacherId })
            .from(classStudents)
            .innerJoin(classes, eq(classes.id, classStudents.classId))
            .where(eq(classStudents.studentId, input.studentId));
          const teacherIds = Array.from(
            new Set(classRows.map((row) => Number(row.teacherId)).filter((id) => id > 0)),
          );

          let canAccess = false;
          for (const teacherId of teacherIds) {
            const allowed = await canStudentAccessPaidFeature(
              Number(input.studentId),
              SUBSCRIPTION_FEATURES.studentGallery,
              teacherId,
            );
            if (allowed) {
              canAccess = true;
              break;
            }
          }

          if (!canAccess) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "هذه الميزة غير متاحة حاليًا في حساب معلمك.",
            });
          }
        }

        const isSelf = Number(ctx.user.id) === Number(input.studentId);
        const isAdmin = ctx.user.role === "admin";

        if (!isSelf && !isAdmin) {
          if (ctx.user.role !== "teacher") {
            throw new TRPCError({ code: "FORBIDDEN", message: "غير مصرح لك بعرض هذا الملف الفني" });
          }

          const linkedStudent = await database
            .select({ id: classStudents.id })
            .from(classStudents)
            .innerJoin(classes, eq(classStudents.classId, classes.id))
            .where(and(eq(classStudents.studentId, input.studentId), eq(classes.teacherId, ctx.user.id)))
            .limit(1);

          if (!linkedStudent[0]) {
            throw new TRPCError({ code: "FORBIDDEN", message: "يمكنك عرض ملفات طلاب فصولك فقط" });
          }
        }

        const studentRows = await database
          .select({
            id: users.id,
            name: users.name,
            role: users.role,
          })
          .from(users)
          .where(eq(users.id, input.studentId))
          .limit(1);

        if (!studentRows[0]) {
          throw new TRPCError({ code: "NOT_FOUND", message: "الطالب غير موجود" });
        }

        const classRows = await database
          .select({
            classId: classStudents.classId,
            className: classes.name,
            grade: classes.grade,
          })
          .from(classStudents)
          .innerJoin(classes, eq(classStudents.classId, classes.id))
          .where(eq(classStudents.studentId, input.studentId))
          .orderBy(desc(classStudents.joinedAt))
          .limit(1);

        const [statsRows, badgesRows, recentArtworksRows] = await Promise.all([
          database
            .select({
              totalArtworks: sql<number>`count(*)`,
              publishedArtworks: sql<number>`sum(case when ${artworks.status} = 'published' then 1 else 0 end)`,
              featuredArtworks: sql<number>`sum(case when ${artworks.isFeatured} = true then 1 else 0 end)`,
              competitionParticipations: sql<number>`count(distinct case when ${artworks.competitionId} is not null then ${artworks.competitionId} end)`,
              winsOrPlaces: sql<number>`sum(
                case
                  when ${artworks.competitionId} is not null and (
                    ${artworks.id} = (
                      select c.firstPlaceArtworkId
                      from competitions c
                      where c.id = ${artworks.competitionId}
                      limit 1
                    )
                    or ${artworks.id} = (
                      select c.secondPlaceArtworkId
                      from competitions c
                      where c.id = ${artworks.competitionId}
                      limit 1
                    )
                    or ${artworks.id} = (
                      select c.thirdPlaceArtworkId
                      from competitions c
                      where c.id = ${artworks.competitionId}
                      limit 1
                    )
                  ) then 1
                  else 0
                end
              )`,
            })
            .from(artworks)
            .where(eq(artworks.studentId, input.studentId)),
          database
            .select({
              studentBadgeId: studentBadges.id,
              earnedAt: studentBadges.earnedAt,
              badge: badges,
            })
            .from(studentBadges)
            .innerJoin(badges, eq(studentBadges.badgeId, badges.id))
            .where(and(eq(studentBadges.studentId, input.studentId), eq(badges.isVisible, true)))
            .orderBy(desc(studentBadges.earnedAt)),
          database
            .select({
              id: artworks.id,
              title: artworks.title,
              description: artworks.description,
              imageUrl: artworks.imageUrl,
              imageKey: artworks.imageKey,
              status: artworks.status,
              isPublic: artworks.isPublic,
              isFeatured: artworks.isFeatured,
              competitionId: artworks.competitionId,
              competitionVotes: artworks.competitionVotes,
              competitionTitle: competitions.title,
              createdAt: artworks.createdAt,
              competitionPlace: sql<CompetitionPlace>`(
                case
                  when ${artworks.competitionId} is null then null
                  when ${artworks.id} = (
                    select c.firstPlaceArtworkId
                    from competitions c
                    where c.id = ${artworks.competitionId}
                    limit 1
                  ) then 'first'
                  when ${artworks.id} = (
                    select c.secondPlaceArtworkId
                    from competitions c
                    where c.id = ${artworks.competitionId}
                    limit 1
                  ) then 'second'
                  when ${artworks.id} = (
                    select c.thirdPlaceArtworkId
                    from competitions c
                    where c.id = ${artworks.competitionId}
                    limit 1
                  ) then 'third'
                  else null
                end
              )`,
            })
            .from(artworks)
            .leftJoin(competitions, eq(artworks.competitionId, competitions.id))
            .where(eq(artworks.studentId, input.studentId))
            .orderBy(desc(artworks.createdAt))
            .limit(12),
        ]);

        const stats = statsRows[0] || {
          totalArtworks: 0,
          publishedArtworks: 0,
          featuredArtworks: 0,
          competitionParticipations: 0,
          winsOrPlaces: 0,
        };

        const recentArtworks = await Promise.all(
          recentArtworksRows.map(async (row: any) => ({
            ...row,
            imageUrl: await resolveArtworkImageUrl(row.imageUrl, row.imageKey),
          })),
        );

        return {
          student: {
            id: studentRows[0].id,
            name: studentRows[0].name || "طالب",
            avatarUrl: null as string | null,
            classId: classRows[0]?.classId || null,
            className: classRows[0]?.className || null,
            grade: classRows[0]?.grade || null,
          },
          stats: {
            totalArtworks: Number(stats.totalArtworks || 0),
            publishedArtworks: Number(stats.publishedArtworks || 0),
            featuredArtworks: Number(stats.featuredArtworks || 0),
            competitionParticipations: Number(stats.competitionParticipations || 0),
            winsOrPlaces: Number(stats.winsOrPlaces || 0),
          },
          badges: badgesRows,
          artworks: recentArtworks,
        };
      }),

    getAiFeedback: protectedProcedure
      .input(
        z.object({
          artworkId: z.number(),
        })
      )
      .query(async ({ ctx, input }) => {
        const { database } = await canAccessArtworkAiFeedback({
          artworkId: input.artworkId,
          user: ctx.user,
        });

        const rows = await database
          .select()
          .from(artworkAiFeedback)
          .where(eq(artworkAiFeedback.artworkId, input.artworkId))
          .limit(1);

        return rows[0] || null;
      }),

    generateAiFeedback: protectedProcedure
      .input(
        z.object({
          artworkId: z.number(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role === "teacher") {
          await assertTeacherFeatureAccess({
            user: ctx.user,
            featureCode: SUBSCRIPTION_FEATURES.aiAssistant,
          });
        }

        const { database, artwork } = await canAccessArtworkAiFeedback({
          artworkId: input.artworkId,
          user: ctx.user,
        });

        const challengeRows = await database
          .select({ title: challenges.title })
          .from(challengeSubmissions)
          .leftJoin(challenges, eq(challengeSubmissions.challengeId, challenges.id))
          .where(eq(challengeSubmissions.artworkId, input.artworkId))
          .orderBy(desc(challengeSubmissions.submittedAt))
          .limit(1);

        const lessonRows = artwork.lessonId
          ? await database
              .select({ title: lessons.title })
              .from(lessons)
              .where(eq(lessons.id, artwork.lessonId))
              .limit(1)
          : [];

        const generated = await generateArtworkAiFeedback({
          title: artwork.title,
          description: artwork.description,
          imageUrl: artwork.imageUrl,
          challengeTitle: challengeRows[0]?.title || null,
          lessonTitle: lessonRows[0]?.title || null,
        });

        const generatedAt = new Date();

        await database
          .insert(artworkAiFeedback)
          .values({
            artworkId: input.artworkId,
            strength: generated.strength,
            improvement: generated.improvement,
            encouragement: generated.encouragement,
            generatedBy: generated.generatedBy,
            model: generated.model,
            generatedAt,
          })
          .onDuplicateKeyUpdate({
            set: {
              strength: generated.strength,
              improvement: generated.improvement,
              encouragement: generated.encouragement,
              generatedBy: generated.generatedBy,
              model: generated.model,
              generatedAt,
            },
          });

        return {
          success: true,
          feedback: {
            artworkId: input.artworkId,
            strength: generated.strength,
            improvement: generated.improvement,
            encouragement: generated.encouragement,
            generatedBy: generated.generatedBy,
            model: generated.model,
            generatedAt,
          },
        };
      }),

    // الحصول على أعمال فصل معين
    getByClass: protectedProcedure
      .input(z.object({ classId: z.number() }))
      .query(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db) return [];

        const classRows = await db.select().from(classes)
          .where(eq(classes.id, input.classId))
          .limit(1);

        const classData = classRows[0];
        if (!classData) {
          throw new TRPCError({ code: "NOT_FOUND", message: "الفصل غير موجود" });
        }

        if (ctx.user.role !== "admin") {
          const canView = ctx.user.role === "teacher" && classData.teacherId === ctx.user.id;
          if (!canView) {
            throw new TRPCError({ code: "FORBIDDEN", message: "غير مصرح لك بعرض أعمال هذا الفصل" });
          }
        }

        const rows = await db
          .select({
            ...getTableColumns(artworks),
            studentName: users.name,
            challengeId: sql<number | null>`(
              select cs.challengeId
              from challengeSubmissions cs
              where cs.artworkId = artworks.id
              order by cs.submittedAt desc
              limit 1
            )`,
            challengeTitle: sql<string | null>`(
              select c.title
              from challengeSubmissions cs
              left join challenges c on c.id = cs.challengeId
              where cs.artworkId = artworks.id
              order by cs.submittedAt desc
              limit 1
            )`,
            submissionStatus: sql<"pending" | "approved" | "rejected" | null>`(
              select cs.status
              from challengeSubmissions cs
              where cs.artworkId = artworks.id
              order by cs.submittedAt desc
              limit 1
            )`,
            latestTeacherComment: sql<string | null>`(
              select r.comment
              from reviews r
              where r.artworkId = artworks.id
                and r.comment is not null
              order by r.createdAt desc
              limit 1
            )`,
            latestTeacherRating: sql<number | null>`(
              select r.rating
              from reviews r
              where r.artworkId = artworks.id
                and r.rating is not null
              order by r.createdAt desc
              limit 1
            )`,
            aiGeneratedAt: sql<Date | null>`(
              select aif.generatedAt
              from artworkAiFeedback aif
              where aif.artworkId = artworks.id
              limit 1
            )`,
            competitionPlace: sql<CompetitionPlace>`(
              case
                when artworks.competitionId is null then null
                when artworks.id = (
                  select c.firstPlaceArtworkId
                  from competitions c
                  where c.id = artworks.competitionId
                  limit 1
                ) then 'first'
                when artworks.id = (
                  select c.secondPlaceArtworkId
                  from competitions c
                  where c.id = artworks.competitionId
                  limit 1
                ) then 'second'
                when artworks.id = (
                  select c.thirdPlaceArtworkId
                  from competitions c
                  where c.id = artworks.competitionId
                  limit 1
                ) then 'third'
                else null
              end
            )`,
          })
          .from(artworks)
          .leftJoin(users, eq(artworks.studentId, users.id))
          .where(eq(artworks.classId, input.classId))
          .orderBy(desc(artworks.createdAt));

        return Promise.all(
          rows.map(async (row: any) => ({
            ...row,
            imageUrl: await resolveArtworkImageUrl(row.imageUrl, row.imageKey),
          })),
        );
      }),

    getClassGallerySettings: protectedProcedure
      .input(z.object({ classId: z.number() }))
      .query(async ({ ctx, input }) => {
        const database = await getDb();
        if (!database) {
          return buildDefaultClassGallerySettings();
        }

        const classRows = await database
          .select({ id: classes.id, name: classes.name, teacherId: classes.teacherId })
          .from(classes)
          .where(eq(classes.id, input.classId))
          .limit(1);

        const classRow = classRows[0];
        if (!classRow) {
          throw new TRPCError({ code: "NOT_FOUND", message: "الفصل غير موجود" });
        }

        if (ctx.user.role !== "admin" && classRow.teacherId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN", message: "غير مصرح لك بعرض إعدادات هذا الفصل" });
        }

        let settingsRows: any[] = [];
        try {
          settingsRows = await database
            .select()
            .from(classGallerySettings)
            .where(eq(classGallerySettings.classId, input.classId))
            .limit(1);
        } catch (error) {
          if (!isMissingGallerySettingsSchemaError(error)) throw error;
        }

        const fallback = buildDefaultClassGallerySettings(classRow.name);
        const row = settingsRows[0];
        if (!row) return fallback;

        return {
          enabled: Boolean(row.enabled),
          heroTitle: row.heroTitle || fallback.heroTitle,
          heroDescription: row.heroDescription || fallback.heroDescription,
          headerImageUrl: row.headerImageUrl || "",
          featuredArtworkIds: parseNumberArrayJson(row.featuredArtworkIdsJson),
          imageErrorTitle: row.imageErrorTitle || fallback.imageErrorTitle,
          imageErrorDescription: row.imageErrorDescription || fallback.imageErrorDescription,
          slideshowEnabled: typeof row.slideshowEnabled === "undefined" ? fallback.slideshowEnabled : Boolean(row.slideshowEnabled),
          slideshowIntervalSeconds: normalizeSlideshowIntervalSeconds(row.slideshowIntervalSeconds, fallback.slideshowIntervalSeconds),
          slideshowShowDetails: typeof row.slideshowShowDetails === "undefined" ? fallback.slideshowShowDetails : Boolean(row.slideshowShowDetails),
        };
      }),

    updateClassGallerySettings: protectedProcedure
      .input(
        z.object({
          classId: z.number(),
          enabled: z.boolean(),
          heroTitle: z.string().min(3).max(255),
          heroDescription: z.string().min(3).max(5000),
          headerImageUrl: z.string().max(5000).optional(),
          featuredArtworkIds: z.array(z.number().int().positive()).max(100),
          imageErrorTitle: z.string().min(3).max(255),
          imageErrorDescription: z.string().min(3).max(5000),
          visibility: z.enum(GALLERY_VISIBILITY_VALUES).default("private"),
          shareEnabled: z.boolean().default(false),
          showStudentNames: z.boolean().default(true),
          showArtistName: z.boolean().default(true),
          allowPublicViewing: z.boolean().default(false),
          slideshowEnabled: z.boolean().default(true),
          slideshowIntervalSeconds: z.number().int().min(3).max(15).default(5),
          slideshowShowDetails: z.boolean().default(false),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const classRows = await database
          .select({ id: classes.id, name: classes.name, teacherId: classes.teacherId })
          .from(classes)
          .where(eq(classes.id, input.classId))
          .limit(1);

        const classRow = classRows[0];
        if (!classRow) {
          throw new TRPCError({ code: "NOT_FOUND", message: "الفصل غير موجود" });
        }

        if (ctx.user.role !== "admin" && classRow.teacherId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN", message: "غير مصرح لك بتحديث إعدادات هذا الفصل" });
        }

        const featuredIds = Array.from(new Set(input.featuredArtworkIds));
        const payload = {
          classId: input.classId,
          enabled: input.enabled,
          heroTitle: input.heroTitle.trim(),
          heroDescription: input.heroDescription.trim(),
          headerImageUrl: String(input.headerImageUrl || "").trim(),
          featuredArtworkIdsJson: JSON.stringify(featuredIds),
          imageErrorTitle: input.imageErrorTitle.trim(),
          imageErrorDescription: input.imageErrorDescription.trim(),
          visibility: normalizeGalleryVisibility(input.visibility),
          shareSlug: "",
          shareEnabled: Boolean(input.shareEnabled),
          showStudentNames: Boolean(input.showStudentNames),
          showArtistName: Boolean(input.showArtistName),
          allowPublicViewing: Boolean(input.allowPublicViewing),
          slideshowEnabled: input.slideshowEnabled,
          slideshowIntervalSeconds: normalizeSlideshowIntervalSeconds(input.slideshowIntervalSeconds),
          slideshowShowDetails: input.slideshowShowDetails,
          updatedAt: new Date(),
        };

        let existingShareSlug = "";
        try {
          const existingRows = await database
            .select({ shareSlug: classGallerySettings.shareSlug })
            .from(classGallerySettings)
            .where(eq(classGallerySettings.classId, input.classId))
            .limit(1);
          existingShareSlug = String(existingRows[0]?.shareSlug || "").trim();
        } catch (error) {
          if (!isMissingGallerySettingsSchemaError(error)) throw error;
        }

        payload.shareSlug = existingShareSlug || buildRandomShareSlug("c");

        try {
          await database
            .insert(classGallerySettings)
            .values(payload)
            .onDuplicateKeyUpdate({
              set: {
                enabled: payload.enabled,
                heroTitle: payload.heroTitle,
                heroDescription: payload.heroDescription,
                headerImageUrl: payload.headerImageUrl,
                featuredArtworkIdsJson: payload.featuredArtworkIdsJson,
                imageErrorTitle: payload.imageErrorTitle,
                imageErrorDescription: payload.imageErrorDescription,
                visibility: payload.visibility,
                shareSlug: payload.shareSlug,
                shareEnabled: payload.shareEnabled,
                showStudentNames: payload.showStudentNames,
                showArtistName: payload.showArtistName,
                allowPublicViewing: payload.allowPublicViewing,
                slideshowEnabled: payload.slideshowEnabled,
                slideshowIntervalSeconds: payload.slideshowIntervalSeconds,
                slideshowShowDetails: payload.slideshowShowDetails,
                updatedAt: new Date(),
              },
            });
        } catch (error) {
          if (!isMissingGallerySettingsSchemaError(error)) throw error;

          const legacyPayload = withoutGallerySharingFields(withoutGallerySlideshowFields(payload));
          await database
            .insert(classGallerySettings)
            .values(legacyPayload as any)
            .onDuplicateKeyUpdate({
              set: {
                enabled: payload.enabled,
                heroTitle: payload.heroTitle,
                heroDescription: payload.heroDescription,
                headerImageUrl: payload.headerImageUrl,
                featuredArtworkIdsJson: payload.featuredArtworkIdsJson,
                imageErrorTitle: payload.imageErrorTitle,
                imageErrorDescription: payload.imageErrorDescription,
                updatedAt: new Date(),
              } as any,
            });
        }

        return { success: true };
      }),

    regenerateClassGalleryShareLink: protectedProcedure
      .input(z.object({ classId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const classRows = await database
          .select({ id: classes.id, name: classes.name, teacherId: classes.teacherId })
          .from(classes)
          .where(eq(classes.id, input.classId))
          .limit(1);
        const classRow = classRows[0];
        if (!classRow) throw new TRPCError({ code: "NOT_FOUND", message: "الفصل غير موجود" });
        if (ctx.user.role !== "admin" && classRow.teacherId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN", message: "غير مصرح لك" });
        }

        const nextSlug = buildRandomShareSlug("c");
        const defaults = buildDefaultClassGallerySettings(classRow.name);

        try {
          await database
            .insert(classGallerySettings)
            .values({
              classId: input.classId,
              enabled: defaults.enabled,
              heroTitle: defaults.heroTitle,
              heroDescription: defaults.heroDescription,
              headerImageUrl: defaults.headerImageUrl,
              featuredArtworkIdsJson: JSON.stringify(defaults.featuredArtworkIds),
              imageErrorTitle: defaults.imageErrorTitle,
              imageErrorDescription: defaults.imageErrorDescription,
              shareSlug: nextSlug,
              shareEnabled: true,
              visibility: "unlisted",
              showStudentNames: defaults.showStudentNames,
              showArtistName: defaults.showArtistName,
              allowPublicViewing: true,
              slideshowEnabled: defaults.slideshowEnabled,
              slideshowIntervalSeconds: defaults.slideshowIntervalSeconds,
              slideshowShowDetails: defaults.slideshowShowDetails,
              updatedAt: new Date(),
            } as any)
            .onDuplicateKeyUpdate({
              set: {
                shareSlug: nextSlug,
                shareEnabled: true,
                visibility: "unlisted",
                allowPublicViewing: true,
                updatedAt: new Date(),
              } as any,
            });
        } catch (error) {
          if (!isMissingGallerySettingsSchemaError(error)) throw error;
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "تحتاج قاعدة البيانات إلى ترحيل إعدادات المشاركة العامة" });
        }

        return { shareSlug: nextSlug };
      }),

    disableClassGalleryShareLink: protectedProcedure
      .input(z.object({ classId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const classRows = await database
          .select({ id: classes.id, name: classes.name, teacherId: classes.teacherId })
          .from(classes)
          .where(eq(classes.id, input.classId))
          .limit(1);
        const classRow = classRows[0];
        if (!classRow) throw new TRPCError({ code: "NOT_FOUND", message: "الفصل غير موجود" });
        if (ctx.user.role !== "admin" && classRow.teacherId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN", message: "غير مصرح لك" });
        }

        try {
          const defaults = buildDefaultClassGallerySettings(classRow.name);
          await database
            .insert(classGallerySettings)
            .values({
              classId: input.classId,
              enabled: defaults.enabled,
              heroTitle: defaults.heroTitle,
              heroDescription: defaults.heroDescription,
              headerImageUrl: defaults.headerImageUrl,
              featuredArtworkIdsJson: JSON.stringify(defaults.featuredArtworkIds),
              imageErrorTitle: defaults.imageErrorTitle,
              imageErrorDescription: defaults.imageErrorDescription,
              shareEnabled: false,
              visibility: "private",
              showStudentNames: defaults.showStudentNames,
              showArtistName: defaults.showArtistName,
              allowPublicViewing: false,
              slideshowEnabled: defaults.slideshowEnabled,
              slideshowIntervalSeconds: defaults.slideshowIntervalSeconds,
              slideshowShowDetails: defaults.slideshowShowDetails,
              updatedAt: new Date(),
            } as any)
            .onDuplicateKeyUpdate({
              set: {
                shareEnabled: false,
                visibility: "private",
                allowPublicViewing: false,
                updatedAt: new Date(),
              } as any,
            });
        } catch (error) {
          if (!isMissingGallerySettingsSchemaError(error)) throw error;
        }

        return { success: true };
      }),

    getClassSharedGallery: publicProcedure
      .input(z.object({ shareSlug: z.string().min(8).max(96) }))
      .query(async ({ input }) => {
        const database = await getDb();
        if (!database) {
          return { status: "not_found" as const, message: "الرابط غير صالح" };
        }

        let settingsRow: any = null;
        try {
          const rows = await database
            .select()
            .from(classGallerySettings)
            .where(eq(classGallerySettings.shareSlug, input.shareSlug))
            .limit(1);
          settingsRow = rows[0] || null;
        } catch (error) {
          if (isMissingGallerySettingsSchemaError(error)) {
            return { status: "unavailable" as const, message: "المعرض غير متاح حاليًا" };
          }
          throw error;
        }

        if (!settingsRow) {
          return { status: "not_found" as const, message: "الرابط غير صالح" };
        }

        const settings = {
          enabled: Boolean(settingsRow.enabled),
          heroTitle: String(settingsRow.heroTitle || "معرض الفصل"),
          heroDescription: String(settingsRow.heroDescription || ""),
          headerImageUrl: String(settingsRow.headerImageUrl || ""),
          featuredArtworkIds: parseNumberArrayJson(settingsRow.featuredArtworkIdsJson),
          imageErrorTitle: String(settingsRow.imageErrorTitle || "تعذر عرض الصورة"),
          imageErrorDescription: String(settingsRow.imageErrorDescription || "لا نعرض مساحة فارغة. يمكنك إعادة المحاولة أو فتح تفاصيل العمل."),
          visibility: normalizeGalleryVisibility(settingsRow.visibility),
          shareSlug: String(settingsRow.shareSlug || "").trim(),
          shareEnabled: Boolean(settingsRow.shareEnabled),
          showStudentNames:
            typeof settingsRow.showStudentNames === "undefined"
              ? true
              : Boolean(settingsRow.showStudentNames),
          showArtistName:
            typeof settingsRow.showArtistName === "undefined"
              ? true
              : Boolean(settingsRow.showArtistName),
          allowPublicViewing:
            typeof settingsRow.allowPublicViewing === "undefined"
              ? false
              : Boolean(settingsRow.allowPublicViewing),
          slideshowEnabled: typeof settingsRow.slideshowEnabled === "undefined" ? true : Boolean(settingsRow.slideshowEnabled),
          slideshowIntervalSeconds: normalizeSlideshowIntervalSeconds(settingsRow.slideshowIntervalSeconds, 5),
          slideshowShowDetails:
            typeof settingsRow.slideshowShowDetails === "undefined"
              ? false
              : Boolean(settingsRow.slideshowShowDetails),
        };

        if (!isGalleryPubliclyAccessible(settings)) {
          return { status: "unavailable" as const, message: "هذا المعرض غير متاح حاليًا" };
        }

        const classRows = await database
          .select({ id: classes.id, name: classes.name, grade: classes.grade })
          .from(classes)
          .where(eq(classes.id, Number(settingsRow.classId)))
          .limit(1);
        const classInfo = classRows[0] || null;
        if (!classInfo) {
          return { status: "not_found" as const, message: "الرابط غير صالح" };
        }

        const rows = await database
          .select({
            ...getTableColumns(artworks),
            studentName: users.name,
          })
          .from(artworks)
          .leftJoin(users, eq(artworks.studentId, users.id))
          .where(
            and(
              eq(artworks.classId, classInfo.id),
              eq(artworks.isPublic, true),
              eq(artworks.showInClassGallery, true),
              eq(artworks.status, "published"),
            ),
          )
          .orderBy(desc(artworks.createdAt));

        const normalizedRows = await Promise.all(
          rows.map(async (row: any) => ({
            ...row,
            studentName: settings.showStudentNames && settings.showArtistName ? row.studentName : null,
            imageUrl: await resolveArtworkImageUrl(row.imageUrl, row.imageKey),
          })),
        );

        const featuredMap = new Map<number, number>();
        settings.featuredArtworkIds.forEach((id, index) => featuredMap.set(Number(id), index));
        normalizedRows.sort((left: any, right: any) => {
          const leftIndex = featuredMap.has(Number(left.id)) ? Number(featuredMap.get(Number(left.id))) : Number.MAX_SAFE_INTEGER;
          const rightIndex = featuredMap.has(Number(right.id)) ? Number(featuredMap.get(Number(right.id))) : Number.MAX_SAFE_INTEGER;
          if (leftIndex !== rightIndex) return leftIndex - rightIndex;
          return new Date(String(right.createdAt || "")).getTime() - new Date(String(left.createdAt || "")).getTime();
        });

        return {
          status: "ok" as const,
          classInfo,
          settings,
          artworks: normalizedRows,
        };
      }),

    getStudentGalleryShareSettings: protectedProcedure
      .input(z.object({ studentId: z.number().int().positive() }))
      .query(async ({ ctx, input }) => {
        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const membership = await getLatestStudentClassMembership(database, input.studentId);
        if (!membership) throw new TRPCError({ code: "NOT_FOUND", message: "الطالب غير موجود" });

        if (ctx.user.role !== "admin" && membership.teacherId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN", message: "يمكنك إدارة مشاركة طلاب فصولك فقط" });
        }

        const fallback = buildDefaultStudentGallerySettings({
          studentId: input.studentId,
          teacherId: Number(membership.teacherId),
          classId: Number(membership.classId),
        });

        let row: any = null;
        try {
          const rows = await database
            .select()
            .from(studentGallerySettings)
            .where(eq(studentGallerySettings.studentId, input.studentId))
            .limit(1);
          row = rows[0] || null;
        } catch (error) {
          if (!isMissingGallerySettingsSchemaError(error)) throw error;
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "تحتاج قاعدة البيانات إلى ترحيل إعدادات مشاركة معرض الطالب" });
        }

        return {
          studentId: input.studentId,
          studentName: String(membership.studentName || "طالب"),
          classId: Number(membership.classId),
          className: String(membership.className || ""),
          visibility: normalizeGalleryVisibility(row?.visibility, fallback.visibility),
          shareSlug: String(row?.shareSlug || "").trim(),
          shareEnabled: typeof row?.shareEnabled === "undefined" ? fallback.shareEnabled : Boolean(row.shareEnabled),
          showStudentName: typeof row?.showStudentName === "undefined" ? fallback.showStudentName : Boolean(row.showStudentName),
          showFirstNameOnly:
            typeof row?.showFirstNameOnly === "undefined"
              ? fallback.showFirstNameOnly
              : Boolean(row.showFirstNameOnly),
          showClassName: typeof row?.showClassName === "undefined" ? fallback.showClassName : Boolean(row.showClassName),
          showSchoolName: typeof row?.showSchoolName === "undefined" ? fallback.showSchoolName : Boolean(row.showSchoolName),
          showBadges: typeof row?.showBadges === "undefined" ? fallback.showBadges : Boolean(row.showBadges),
          showCertificates:
            typeof row?.showCertificates === "undefined"
              ? fallback.showCertificates
              : Boolean(row.showCertificates),
          showVotes: typeof row?.showVotes === "undefined" ? fallback.showVotes : Boolean(row.showVotes),
          allowPublicViewing:
            typeof row?.allowPublicViewing === "undefined"
              ? fallback.allowPublicViewing
              : Boolean(row.allowPublicViewing),
        };
      }),

    getMyStudentPublicProfileShareStatus: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role !== "student" && ctx.user.role !== "user") {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      const database = await getDb();
      if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const membership = await getLatestStudentClassMembership(database, Number(ctx.user.id));
      if (!membership) {
        return {
          enabled: true,
          visibility: "unlisted" as GalleryVisibility,
          shareSlug: "",
          linkPath: `/artist/${ctx.user.id}`,
        };
      }

      const fallback = buildDefaultStudentGallerySettings({
        studentId: Number(ctx.user.id),
        teacherId: Number(membership.teacherId),
        classId: Number(membership.classId),
      });

      let row: any = null;
      try {
        const rows = await database
          .select()
          .from(studentGallerySettings)
          .where(eq(studentGallerySettings.studentId, Number(ctx.user.id)))
          .limit(1);
        row = rows[0] || null;
      } catch (error) {
        if (!isMissingGallerySettingsSchemaError(error)) throw error;
      }

      const visibility = normalizeGalleryVisibility(row?.visibility, fallback.visibility);
      const enabled =
        visibility !== "private" &&
        Boolean(row?.shareEnabled ?? fallback.shareEnabled) &&
        Boolean(row?.allowPublicViewing ?? fallback.allowPublicViewing);

      const shareSlug = String(row?.shareSlug || "").trim();
      const linkPath = shareSlug ? `/artist/${shareSlug}` : `/artist/${ctx.user.id}`;

      return {
        enabled,
        visibility,
        shareSlug,
        linkPath,
      };
    }),

    updateStudentGalleryShareSettings: protectedProcedure
      .input(
        z.object({
          studentId: z.number().int().positive(),
          visibility: z.enum(GALLERY_VISIBILITY_VALUES).default("private"),
          shareEnabled: z.boolean().default(false),
          showStudentName: z.boolean().default(true),
          showFirstNameOnly: z.boolean().default(false),
          showClassName: z.boolean().default(true),
          showSchoolName: z.boolean().default(false),
          showBadges: z.boolean().default(true),
          showCertificates: z.boolean().default(false),
          showVotes: z.boolean().default(true),
          allowPublicViewing: z.boolean().default(false),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const membership = await getLatestStudentClassMembership(database, input.studentId);
        if (!membership) throw new TRPCError({ code: "NOT_FOUND", message: "الطالب غير موجود" });
        if (ctx.user.role !== "admin" && membership.teacherId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN", message: "يمكنك إدارة مشاركة طلاب فصولك فقط" });
        }

        let currentSlug = "";
        try {
          const rows = await database
            .select({ shareSlug: studentGallerySettings.shareSlug })
            .from(studentGallerySettings)
            .where(eq(studentGallerySettings.studentId, input.studentId))
            .limit(1);
          currentSlug = String(rows[0]?.shareSlug || "").trim();
        } catch (error) {
          if (!isMissingGallerySettingsSchemaError(error)) throw error;
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "تحتاج قاعدة البيانات إلى ترحيل إعدادات مشاركة معرض الطالب" });
        }

        const payload = {
          studentId: input.studentId,
          teacherId: Number(membership.teacherId),
          classId: Number(membership.classId),
          visibility: normalizeGalleryVisibility(input.visibility),
          shareSlug: currentSlug || buildRandomShareSlug("s"),
          shareEnabled: Boolean(input.shareEnabled),
          showStudentName: Boolean(input.showStudentName),
          showFirstNameOnly: Boolean(input.showFirstNameOnly),
          showClassName: Boolean(input.showClassName),
          showSchoolName: Boolean(input.showSchoolName),
          showBadges: Boolean(input.showBadges),
          showCertificates: Boolean(input.showCertificates),
          showVotes: Boolean(input.showVotes),
          allowPublicViewing: Boolean(input.allowPublicViewing),
          updatedAt: new Date(),
        };

        await database
          .insert(studentGallerySettings)
          .values(payload)
          .onDuplicateKeyUpdate({ set: payload });

        return { success: true, shareSlug: payload.shareSlug };
      }),

    regenerateStudentGalleryShareLink: protectedProcedure
      .input(z.object({ studentId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const membership = await getLatestStudentClassMembership(database, input.studentId);
        if (!membership) throw new TRPCError({ code: "NOT_FOUND", message: "الطالب غير موجود" });
        if (ctx.user.role !== "admin" && membership.teacherId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN", message: "يمكنك إدارة مشاركة طلاب فصولك فقط" });
        }

        const slug = buildRandomShareSlug("s");
        await database
          .insert(studentGallerySettings)
          .values({
            studentId: input.studentId,
            teacherId: Number(membership.teacherId),
            classId: Number(membership.classId),
            visibility: "unlisted",
            shareSlug: slug,
            shareEnabled: true,
            showStudentName: true,
            showFirstNameOnly: false,
            showClassName: true,
            showSchoolName: false,
            showBadges: true,
            showCertificates: false,
            showVotes: true,
            allowPublicViewing: true,
            updatedAt: new Date(),
          })
          .onDuplicateKeyUpdate({
            set: {
              visibility: "unlisted",
              shareSlug: slug,
              shareEnabled: true,
              allowPublicViewing: true,
              updatedAt: new Date(),
            },
          });

        return { shareSlug: slug };
      }),

    disableStudentGalleryShareLink: protectedProcedure
      .input(z.object({ studentId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const membership = await getLatestStudentClassMembership(database, input.studentId);
        if (!membership) throw new TRPCError({ code: "NOT_FOUND", message: "الطالب غير موجود" });
        if (ctx.user.role !== "admin" && membership.teacherId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN", message: "يمكنك إدارة مشاركة طلاب فصولك فقط" });
        }

        await database
          .insert(studentGallerySettings)
          .values({
            studentId: input.studentId,
            teacherId: Number(membership.teacherId),
            classId: Number(membership.classId),
            visibility: "private",
            shareSlug: buildRandomShareSlug("s"),
            shareEnabled: false,
            showStudentName: true,
            showFirstNameOnly: false,
            showClassName: true,
            showSchoolName: false,
            showBadges: true,
            showCertificates: false,
            showVotes: true,
            allowPublicViewing: false,
            updatedAt: new Date(),
          })
          .onDuplicateKeyUpdate({
            set: {
              visibility: "private",
              shareEnabled: false,
              allowPublicViewing: false,
              updatedAt: new Date(),
            },
          });

        return { success: true };
      }),

    getStudentSharedGallery: publicProcedure
      .input(z.object({ shareSlug: z.string().min(8).max(96) }))
      .query(async ({ input }) => {
        const database = await getDb();
        if (!database) {
          return { status: "not_found" as const, message: "الرابط غير صالح" };
        }

        let settingsRow: any = null;
        try {
          const rows = await database
            .select()
            .from(studentGallerySettings)
            .where(eq(studentGallerySettings.shareSlug, input.shareSlug))
            .limit(1);
          settingsRow = rows[0] || null;
        } catch (error) {
          if (isMissingGallerySettingsSchemaError(error)) {
            return { status: "unavailable" as const, message: "المعرض غير متاح حاليًا" };
          }
          throw error;
        }

        if (!settingsRow) {
          return { status: "not_found" as const, message: "الرابط غير صالح" };
        }

        const visibility = normalizeGalleryVisibility(settingsRow.visibility, "private");
        const allowPublicViewing = Boolean(settingsRow.allowPublicViewing);
        const shareEnabled = Boolean(settingsRow.shareEnabled);
        const accessible = (visibility === "public" && allowPublicViewing) || (visibility === "unlisted" && allowPublicViewing && shareEnabled);
        if (!accessible) {
          return { status: "unavailable" as const, message: "هذا المعرض غير متاح حاليًا" };
        }

        const membership = await getLatestStudentClassMembership(database, Number(settingsRow.studentId));
        const studentRows = membership
          ? []
          : await database
              .select({ id: users.id, name: users.name })
              .from(users)
              .where(eq(users.id, Number(settingsRow.studentId)))
              .limit(1);
        const studentRow = studentRows[0] || null;
        if (!membership && !studentRow) {
          return { status: "not_found" as const, message: "الرابط غير صالح" };
        }
        const className = Boolean(settingsRow.showClassName) ? String(membership?.className || settingsRow.fallbackClassName || "") : "";
        const rawStudentName = String(membership?.studentName || settingsRow.fallbackStudentName || studentRow?.name || "طالب");
        const displayStudentName = Boolean(settingsRow.showStudentName)
          ? (Boolean(settingsRow.showFirstNameOnly) ? extractFirstName(rawStudentName) : rawStudentName)
          : "فنان طالب";

        const artworksRows = await database
          .select({
            ...getTableColumns(artworks),
          })
          .from(artworks)
          .where(
            and(
              eq(artworks.studentId, Number(settingsRow.studentId)),
              eq(artworks.isPublic, true),
              eq(artworks.showInStudentPublicGallery, true),
              eq(artworks.status, "published"),
            ),
          )
          .orderBy(desc(artworks.isFeatured), desc(artworks.createdAt))
          .limit(100);

        const normalizedRows = await Promise.all(
          artworksRows.map(async (row: any) => ({
            ...row,
            competitionVotes: Boolean(settingsRow.showVotes) ? row.competitionVotes : null,
            studentName: displayStudentName,
            className,
            imageUrl: await resolveArtworkImageUrl(row.imageUrl, row.imageKey),
          })),
        );

        const statsRows = await database
          .select({
            totalArtworks: sql<number>`count(*)`,
            publishedArtworks: sql<number>`sum(case when ${artworks.status} = 'published' then 1 else 0 end)`,
            totalVotes: sql<number>`sum(coalesce(${artworks.competitionVotes}, 0))`,
          })
          .from(artworks)
          .where(
            and(
              eq(artworks.studentId, Number(settingsRow.studentId)),
              eq(artworks.isPublic, true),
              eq(artworks.showInStudentPublicGallery, true),
              eq(artworks.status, "published"),
            ),
          );

        const rawStats = statsRows[0] || { totalArtworks: 0, publishedArtworks: 0, totalVotes: 0 };

        let badgesRows: any[] = [];
        if (Boolean(settingsRow.showBadges)) {
          try {
            badgesRows = await database
              .select({
                studentBadgeId: studentBadges.id,
                earnedAt: studentBadges.earnedAt,
                badge: badges,
              })
              .from(studentBadges)
              .innerJoin(badges, eq(studentBadges.badgeId, badges.id))
              .where(and(eq(studentBadges.studentId, Number(settingsRow.studentId)), eq(badges.isVisible, true)))
              .orderBy(desc(studentBadges.earnedAt))
              .limit(24);
          } catch (error) {
            if (!isMissingStudentPublicProfileAddonSchemaError(error)) throw error;
            badgesRows = [];
          }
        }

        let certificatesRows: any[] = [];
        if (Boolean(settingsRow.showCertificates)) {
          try {
            certificatesRows = await database
              .select({
                id: certificates.id,
                title: certificates.title,
                issueDate: certificates.issueDate,
                status: certificates.status,
                pdfUrl: certificates.pdfUrl,
              })
              .from(certificates)
              .where(eq(certificates.studentId, Number(settingsRow.studentId)))
              .orderBy(desc(certificates.issueDate))
              .limit(12);
          } catch (error) {
            if (!isMissingStudentPublicProfileAddonSchemaError(error)) throw error;
            certificatesRows = [];
          }
        }

        return {
          status: "ok" as const,
          student: {
            id: Number(settingsRow.studentId),
            name: displayStudentName,
            className: className || null,
          },
          settings: {
            visibility,
            showStudentName: Boolean(settingsRow.showStudentName),
            showFirstNameOnly: Boolean(settingsRow.showFirstNameOnly),
            showClassName: Boolean(settingsRow.showClassName),
            showSchoolName: Boolean(settingsRow.showSchoolName),
            showBadges: Boolean(settingsRow.showBadges),
            showCertificates: Boolean(settingsRow.showCertificates),
            showVotes: Boolean(settingsRow.showVotes),
          },
          stats: {
            totalArtworks: Number(rawStats.totalArtworks || 0),
            publishedArtworks: Number(rawStats.publishedArtworks || 0),
            totalVotes: Boolean(settingsRow.showVotes) ? Number(rawStats.totalVotes || 0) : null,
          },
          badges: badgesRows,
          certificates: certificatesRows,
          artworks: normalizedRows,
        };
      }),

    getStudentPublicProfile: publicProcedure
      .input(z.object({ identifier: z.string().min(1).max(120) }))
      .query(async ({ input }) => {
        const database = await getDb();
        if (!database) {
          return { status: "not_found" as const, message: "الرابط غير صالح" };
        }

        const rawIdentifier = String(input.identifier || "").trim();
        const numericStudentId = Number(rawIdentifier);
        const isNumericIdentifier = Number.isFinite(numericStudentId) && numericStudentId > 0;

        let settingsRow: any = null;
        try {
          const rows = await database
            .select()
            .from(studentGallerySettings)
            .where(
              isNumericIdentifier
                ? eq(studentGallerySettings.studentId, numericStudentId)
                : eq(studentGallerySettings.shareSlug, rawIdentifier),
            )
            .limit(1);
          settingsRow = rows[0] || null;
        } catch (error) {
          if (isMissingGallerySettingsSchemaError(error)) {
            return { status: "unavailable" as const, message: "صفحة الإنجاز غير متاحة حاليًا" };
          }
          throw error;
        }

        if (!settingsRow) {
          if (!isNumericIdentifier) {
            return { status: "not_found" as const, message: "الرابط غير صالح" };
          }

          const membership = await getLatestStudentClassMembership(database, numericStudentId);
          const studentRows = membership
            ? []
            : await database
                .select({ id: users.id, name: users.name })
                .from(users)
                .where(eq(users.id, numericStudentId))
                .limit(1);
          const studentRow = studentRows[0] || null;
          if (!membership && !studentRow) {
            return { status: "not_found" as const, message: "الرابط غير صالح" };
          }

          settingsRow = {
            ...buildDefaultStudentGallerySettings({
              studentId: numericStudentId,
              teacherId: Number(membership?.teacherId || 0),
              classId: membership?.classId || null,
            }),
            shareSlug: "",
            fallbackStudentName: String(membership?.studentName || studentRow?.name || "ط·ط§ظ„ط¨"),
            fallbackClassName: String(membership?.className || ""),
          } as any;
        }

        const visibility = normalizeGalleryVisibility(settingsRow.visibility, "private");
        const allowPublicViewing = Boolean(settingsRow.allowPublicViewing);
        const shareEnabled = Boolean(settingsRow.shareEnabled);
        const canViewById =
          isNumericIdentifier && visibility !== "private" && allowPublicViewing && shareEnabled;
        const canViewBySlug =
          !isNumericIdentifier &&
          String(settingsRow.shareSlug || "").trim() === rawIdentifier &&
          ((visibility === "public" && allowPublicViewing && shareEnabled) ||
            (visibility === "unlisted" && allowPublicViewing && shareEnabled));

        if (!canViewById && !canViewBySlug) {
          return { status: "unavailable" as const, message: "صفحة الإنجاز غير متاحة حاليًا" };
        }

        const membership = await getLatestStudentClassMembership(database, Number(settingsRow.studentId));
        const studentRows = membership
          ? []
          : await database
              .select({ id: users.id, name: users.name })
              .from(users)
              .where(eq(users.id, Number(settingsRow.studentId)))
              .limit(1);
        const studentRow = studentRows[0] || null;
        if (!membership && !studentRow) {
          return { status: "not_found" as const, message: "الرابط غير صالح" };
        }

        const className = Boolean(settingsRow.showClassName) ? String(membership?.className || settingsRow.fallbackClassName || "") : "";
        const rawStudentName = String(membership?.studentName || settingsRow.fallbackStudentName || studentRow?.name || "طالب");
        const displayStudentName = Boolean(settingsRow.showStudentName)
          ? (Boolean(settingsRow.showFirstNameOnly) ? extractFirstName(rawStudentName) : rawStudentName)
          : "فنان/فنانة";

        const artworksRows = await database
          .select({
            ...getTableColumns(artworks),
          })
          .from(artworks)
          .where(
            and(
              eq(artworks.studentId, Number(settingsRow.studentId)),
              eq(artworks.isPublic, true),
              eq(artworks.showInStudentPublicGallery, true),
              eq(artworks.status, "published"),
            ),
          )
          .orderBy(desc(artworks.isFeatured), desc(artworks.createdAt))
          .limit(120);

        const normalizedRows = await Promise.all(
          artworksRows.map(async (row: any) => ({
            ...row,
            competitionVotes: Boolean(settingsRow.showVotes) ? row.competitionVotes : null,
            studentName: displayStudentName,
            className,
            imageUrl: await resolveArtworkImageUrl(row.imageUrl, row.imageKey),
          })),
        );

        const statsRows = await database
          .select({
            totalArtworks: sql<number>`count(*)`,
            publishedArtworks: sql<number>`sum(case when ${artworks.status} = 'published' then 1 else 0 end)`,
            totalVotes: sql<number>`sum(coalesce(${artworks.competitionVotes}, 0))`,
          })
          .from(artworks)
          .where(
            and(
              eq(artworks.studentId, Number(settingsRow.studentId)),
              eq(artworks.isPublic, true),
              eq(artworks.showInStudentPublicGallery, true),
              eq(artworks.status, "published"),
            ),
          );

        const rawStats = statsRows[0] || { totalArtworks: 0, publishedArtworks: 0, totalVotes: 0 };

        let badgesRows: any[] = [];
        if (Boolean(settingsRow.showBadges)) {
          try {
            badgesRows = await database
              .select({
                studentBadgeId: studentBadges.id,
                earnedAt: studentBadges.earnedAt,
                badge: badges,
              })
              .from(studentBadges)
              .innerJoin(badges, eq(studentBadges.badgeId, badges.id))
              .where(and(eq(studentBadges.studentId, Number(settingsRow.studentId)), eq(badges.isVisible, true)))
              .orderBy(desc(studentBadges.earnedAt))
              .limit(24);
          } catch (error) {
            if (!isMissingStudentPublicProfileAddonSchemaError(error)) throw error;
            badgesRows = [];
          }
        }

        let certificatesRows: any[] = [];
        if (Boolean(settingsRow.showCertificates)) {
          try {
            certificatesRows = await database
              .select({
                id: certificates.id,
                title: certificates.title,
                issueDate: certificates.issueDate,
                status: certificates.status,
                pdfUrl: certificates.pdfUrl,
              })
              .from(certificates)
              .where(eq(certificates.studentId, Number(settingsRow.studentId)))
              .orderBy(desc(certificates.issueDate))
              .limit(12);
          } catch (error) {
            if (!isMissingStudentPublicProfileAddonSchemaError(error)) throw error;
            certificatesRows = [];
          }
        }

        return {
          status: "ok" as const,
          student: {
            id: Number(settingsRow.studentId),
            name: displayStudentName,
            className: className || null,
            schoolName: Boolean(settingsRow.showSchoolName) ? null : null,
          },
          settings: {
            visibility,
            showStudentName: Boolean(settingsRow.showStudentName),
            showFirstNameOnly: Boolean(settingsRow.showFirstNameOnly),
            showClassName: Boolean(settingsRow.showClassName),
            showSchoolName: Boolean(settingsRow.showSchoolName),
            showBadges: Boolean(settingsRow.showBadges),
            showCertificates: Boolean(settingsRow.showCertificates),
            showVotes: Boolean(settingsRow.showVotes),
          },
          stats: {
            totalArtworks: Number(rawStats.totalArtworks || 0),
            publishedArtworks: Number(rawStats.publishedArtworks || 0),
            totalVotes: Boolean(settingsRow.showVotes) ? Number(rawStats.totalVotes || 0) : null,
          },
          badges: badgesRows,
          certificates: certificatesRows,
          artworks: normalizedRows,
        };
      }),

    getClassGallery: protectedProcedure
      .input(z.object({ classId: z.number() }))
      .query(async ({ ctx, input }) => {
        const database = await getDb();
        if (!database) {
          return {
            classInfo: null,
            settings: buildDefaultClassGallerySettings(),
            artworks: [],
          };
        }

        const classRows = await database
          .select({ id: classes.id, name: classes.name, grade: classes.grade, teacherId: classes.teacherId })
          .from(classes)
          .where(eq(classes.id, input.classId))
          .limit(1);

        const classRow = classRows[0];
        if (!classRow) {
          throw new TRPCError({ code: "NOT_FOUND", message: "الفصل غير موجود" });
        }

        if (ctx.user.role !== "admin" && classRow.teacherId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN", message: "غير مصرح لك بعرض معرض هذا الفصل" });
        }

        let settingsRows: any[] = [];
        try {
          settingsRows = await database
            .select()
            .from(classGallerySettings)
            .where(eq(classGallerySettings.classId, input.classId))
            .limit(1);
        } catch (error) {
          if (!isMissingGallerySettingsSchemaError(error)) throw error;
        }

        const fallback = buildDefaultClassGallerySettings(classRow.name);
        const settingsRow = settingsRows[0];
        const settings = settingsRow
          ? {
              enabled: Boolean(settingsRow.enabled),
              heroTitle: settingsRow.heroTitle || fallback.heroTitle,
              heroDescription: settingsRow.heroDescription || fallback.heroDescription,
              headerImageUrl: settingsRow.headerImageUrl || "",
              featuredArtworkIds: parseNumberArrayJson(settingsRow.featuredArtworkIdsJson),
              imageErrorTitle: settingsRow.imageErrorTitle || fallback.imageErrorTitle,
              imageErrorDescription: settingsRow.imageErrorDescription || fallback.imageErrorDescription,
              visibility: normalizeGalleryVisibility(settingsRow.visibility, fallback.visibility),
              shareSlug: String(settingsRow.shareSlug || "").trim(),
              shareEnabled:
                typeof settingsRow.shareEnabled === "undefined"
                  ? fallback.shareEnabled
                  : Boolean(settingsRow.shareEnabled),
              showStudentNames:
                typeof settingsRow.showStudentNames === "undefined"
                  ? fallback.showStudentNames
                  : Boolean(settingsRow.showStudentNames),
              showArtistName:
                typeof settingsRow.showArtistName === "undefined"
                  ? fallback.showArtistName
                  : Boolean(settingsRow.showArtistName),
              allowPublicViewing:
                typeof settingsRow.allowPublicViewing === "undefined"
                  ? fallback.allowPublicViewing
                  : Boolean(settingsRow.allowPublicViewing),
              slideshowEnabled:
                typeof settingsRow.slideshowEnabled === "undefined"
                  ? fallback.slideshowEnabled
                  : Boolean(settingsRow.slideshowEnabled),
              slideshowIntervalSeconds: normalizeSlideshowIntervalSeconds(
                settingsRow.slideshowIntervalSeconds,
                fallback.slideshowIntervalSeconds,
              ),
              slideshowShowDetails:
                typeof settingsRow.slideshowShowDetails === "undefined"
                  ? fallback.slideshowShowDetails
                  : Boolean(settingsRow.slideshowShowDetails),
            }
          : fallback;

        const rows = await database
          .select({
            ...getTableColumns(artworks),
            studentName: users.name,
          })
          .from(artworks)
          .leftJoin(users, eq(artworks.studentId, users.id))
          .where(
            and(
              eq(artworks.classId, input.classId),
              eq(artworks.isPublic, true),
              eq(artworks.showInClassGallery, true),
              inArray(artworks.status, ["submitted", "reviewed", "published"])
            )
          )
          .orderBy(desc(artworks.createdAt));

        const normalizedRows = await Promise.all(
          rows.map(async (row: any) => ({
            ...row,
            imageUrl: await resolveArtworkImageUrl(row.imageUrl, row.imageKey),
          }))
        );

        const featuredMap = new Map<number, number>();
        settings.featuredArtworkIds.forEach((id, index) => featuredMap.set(Number(id), index));

        normalizedRows.sort((left: any, right: any) => {
          const leftIndex = featuredMap.has(Number(left.id)) ? Number(featuredMap.get(Number(left.id))) : Number.MAX_SAFE_INTEGER;
          const rightIndex = featuredMap.has(Number(right.id)) ? Number(featuredMap.get(Number(right.id))) : Number.MAX_SAFE_INTEGER;
          if (leftIndex !== rightIndex) return leftIndex - rightIndex;
          return new Date(String(right.createdAt || "")).getTime() - new Date(String(left.createdAt || "")).getTime();
        });

        return {
          classInfo: {
            id: classRow.id,
            name: classRow.name,
            grade: classRow.grade,
          },
          settings,
          artworks: settings.enabled ? normalizedRows : [],
        };
      }),

    getSiteGallerySettings: publicProcedure.query(async () => {
      const database = await getDb();
      if (!database) {
        return DEFAULT_SITE_GALLERY_SETTINGS;
      }

      let rows: any[] = [];
      try {
        rows = await database
          .select()
          .from(siteGallerySettings)
          .where(eq(siteGallerySettings.id, 1))
          .limit(1);
      } catch (error) {
        if (!isMissingGallerySettingsSchemaError(error)) throw error;
        return DEFAULT_SITE_GALLERY_SETTINGS;
      }

      const row = rows[0];
      if (!row) {
        return DEFAULT_SITE_GALLERY_SETTINGS;
      }

      return {
        id: 1,
        heroTitle: row.heroTitle || DEFAULT_SITE_GALLERY_SETTINGS.heroTitle,
        heroDescription: row.heroDescription || DEFAULT_SITE_GALLERY_SETTINGS.heroDescription,
        heroBadge: row.heroBadge || DEFAULT_SITE_GALLERY_SETTINGS.heroBadge,
        heroImageUrl: row.heroImageUrl || "",
        updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : null,
        categories: parseStringArrayJson(row.categoriesJson, DEFAULT_SITE_GALLERY_SETTINGS.categories),
        emptyTitle: row.emptyTitle || DEFAULT_SITE_GALLERY_SETTINGS.emptyTitle,
        emptyDescription: row.emptyDescription || DEFAULT_SITE_GALLERY_SETTINGS.emptyDescription,
        imageErrorTitle: row.imageErrorTitle || DEFAULT_SITE_GALLERY_SETTINGS.imageErrorTitle,
        imageErrorDescription: row.imageErrorDescription || DEFAULT_SITE_GALLERY_SETTINGS.imageErrorDescription,
        slideshowEnabled:
          typeof row.slideshowEnabled === "undefined"
            ? DEFAULT_SITE_GALLERY_SETTINGS.slideshowEnabled
            : Boolean(row.slideshowEnabled),
        slideshowIntervalSeconds: normalizeSlideshowIntervalSeconds(
          row.slideshowIntervalSeconds,
          DEFAULT_SITE_GALLERY_SETTINGS.slideshowIntervalSeconds,
        ),
        slideshowShowDetails:
          typeof row.slideshowShowDetails === "undefined"
            ? DEFAULT_SITE_GALLERY_SETTINGS.slideshowShowDetails
            : Boolean(row.slideshowShowDetails),
      };
    }),

    // الحصول على الأعمال العامة (المعرض)
    getPublic: publicProcedure.query(async () => {
      const db = await getDb();
      if (!db) return [];

      const rows = await db
        .select({
          ...getTableColumns(artworks),
          studentName: users.name,
          competitionPlace: sql<CompetitionPlace>`(
            case
              when artworks.competitionId is null then null
              when artworks.id = (
                select c.firstPlaceArtworkId
                from competitions c
                where c.id = artworks.competitionId
                limit 1
              ) then 'first'
              when artworks.id = (
                select c.secondPlaceArtworkId
                from competitions c
                where c.id = artworks.competitionId
                limit 1
              ) then 'second'
              when artworks.id = (
                select c.thirdPlaceArtworkId
                from competitions c
                where c.id = artworks.competitionId
                limit 1
              ) then 'third'
              else null
            end
          )`,
        })
        .from(artworks)
        .leftJoin(users, eq(artworks.studentId, users.id))
        .where(
          and(
            // Keep teacher approval flow intact for public gallery publishing.
            eq(artworks.isPublic, true),
            // Phase C: main site gallery is admin-curated via explicit site visibility flag.
            eq(artworks.showInSiteGallery, true),
            // Exclude draft items from public gallery.
            inArray(artworks.status, ["submitted", "reviewed", "published"])
          )
        )
        .orderBy(desc(artworks.isFeatured), desc(artworks.createdAt))
        .limit(50);

      return Promise.all(
        rows.map(async (row: any) => ({
          ...row,
          imageUrl: await resolveArtworkImageUrl(row.imageUrl, row.imageKey),
        })),
      );
    }),

    getTeacherSharedGallery: publicProcedure
      .input(z.object({ identifier: z.string().min(1).max(120) }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) {
          return { status: "not_found" as const, message: "الرابط غير صالح" };
        }

        const rawIdentifier = String(input.identifier || "").trim();
        const teacherId = Number(rawIdentifier);
        const isNumericIdentifier = Number.isFinite(teacherId) && teacherId > 0;

        let teacherRow: any = null;
        let settingRow: any = null;

        try {
          if (isNumericIdentifier) {
            const teachers = await db
              .select({ id: users.id, name: users.name })
              .from(users)
              .where(eq(users.id, teacherId))
              .limit(1);
            teacherRow = teachers[0] || null;

            const settingsRows = await db
              .select()
              .from(teacherGallerySettings)
              .where(eq(teacherGallerySettings.teacherId, teacherId))
              .limit(1);
            settingRow = settingsRows[0] || null;
          } else {
            const settingsRows = await db
              .select()
              .from(teacherGallerySettings)
              .where(eq(teacherGallerySettings.shareSlug, rawIdentifier))
              .limit(1);
            settingRow = settingsRows[0] || null;

            if (settingRow) {
              const teachers = await db
                .select({ id: users.id, name: users.name })
                .from(users)
                .where(eq(users.id, Number(settingRow.teacherId)))
                .limit(1);
              teacherRow = teachers[0] || null;
            }
          }
        } catch (error) {
          if (isMissingGallerySettingsSchemaError(error)) {
            return { status: "unavailable" as const, message: "المعرض غير متاح حاليًا" };
          }
          throw error;
        }

        if (!teacherRow) {
          return { status: "not_found" as const, message: "الرابط غير صالح" };
        }

        const fallbackSettings = buildDefaultTeacherGallerySettings(teacherRow.name);
        const settings = settingRow
          ? {
              enabled: Boolean(settingRow.enabled),
              heroTitle: settingRow.heroTitle || fallbackSettings.heroTitle,
              heroDescription: settingRow.heroDescription || fallbackSettings.heroDescription,
              headerImageUrl: settingRow.headerImageUrl || "",
              featuredArtworkIds: parseNumberArrayJson(settingRow.featuredArtworkIdsJson),
              imageErrorTitle: settingRow.imageErrorTitle || fallbackSettings.imageErrorTitle,
              imageErrorDescription: settingRow.imageErrorDescription || fallbackSettings.imageErrorDescription,
              visibility: normalizeGalleryVisibility(settingRow.visibility, fallbackSettings.visibility),
              shareSlug: String(settingRow.shareSlug || "").trim(),
              shareEnabled:
                typeof settingRow.shareEnabled === "undefined"
                  ? fallbackSettings.shareEnabled
                  : Boolean(settingRow.shareEnabled),
              showArtistName:
                typeof settingRow.showArtistName === "undefined"
                  ? fallbackSettings.showArtistName
                  : Boolean(settingRow.showArtistName),
              allowPublicViewing:
                typeof settingRow.allowPublicViewing === "undefined"
                  ? fallbackSettings.allowPublicViewing
                  : Boolean(settingRow.allowPublicViewing),
              slideshowEnabled:
                typeof settingRow.slideshowEnabled === "undefined"
                  ? fallbackSettings.slideshowEnabled
                  : Boolean(settingRow.slideshowEnabled),
              slideshowIntervalSeconds: normalizeSlideshowIntervalSeconds(
                settingRow.slideshowIntervalSeconds,
                fallbackSettings.slideshowIntervalSeconds,
              ),
              slideshowShowDetails:
                typeof settingRow.slideshowShowDetails === "undefined"
                  ? fallbackSettings.slideshowShowDetails
                  : Boolean(settingRow.slideshowShowDetails),
            }
          : fallbackSettings;

        const canViewByNumericPublicId =
          isNumericIdentifier && settings.visibility === "public" && settings.allowPublicViewing && settings.enabled;
        const canViewByUnlistedSlug =
          !isNumericIdentifier &&
          settings.visibility === "unlisted" &&
          settings.allowPublicViewing &&
          settings.shareEnabled &&
          settings.shareSlug === rawIdentifier;
        const canViewByPublicSlug =
          !isNumericIdentifier &&
          settings.visibility === "public" &&
          settings.allowPublicViewing &&
          settings.enabled &&
          settings.shareSlug === rawIdentifier;

        if (!canViewByNumericPublicId && !canViewByUnlistedSlug && !canViewByPublicSlug) {
          return { status: "unavailable" as const, message: "هذا المعرض غير متاح حاليًا" };
        }

        const galleryRows = await db
          .select({
            id: artworks.id,
            imageUrl: artworks.imageUrl,
            imageKey: artworks.imageKey,
            title: artworks.title,
            studentName: users.name,
            className: classes.name,
            createdAt: artworks.createdAt,
            isFeatured: artworks.isFeatured,
            status: artworks.status,
            competitionId: artworks.competitionId,
            competitionVotes: artworks.competitionVotes,
            competitionPlace: sql<CompetitionPlace>`(
              case
                when artworks.competitionId is null then null
                when artworks.id = (
                  select c.firstPlaceArtworkId
                  from competitions c
                  where c.id = artworks.competitionId
                  limit 1
                ) then 'first'
                when artworks.id = (
                  select c.secondPlaceArtworkId
                  from competitions c
                  where c.id = artworks.competitionId
                  limit 1
                ) then 'second'
                when artworks.id = (
                  select c.thirdPlaceArtworkId
                  from competitions c
                  where c.id = artworks.competitionId
                  limit 1
                ) then 'third'
                else null
              end
            )`,
          })
          .from(artworks)
          .innerJoin(classes, eq(artworks.classId, classes.id))
          .leftJoin(users, eq(artworks.studentId, users.id))
          .where(
            and(
              eq(classes.teacherId, Number(teacherRow.id)),
              eq(artworks.showInTeacherGallery, true),
              eq(artworks.isPublic, true),
              eq(artworks.status, "published"),
            ),
          )
          .orderBy(desc(artworks.isFeatured), desc(artworks.createdAt))
          .limit(100);

        const normalizedGalleryRows = await Promise.all(
          galleryRows.map(async (row: any) => ({
            ...row,
            studentName: settings.showArtistName ? row.studentName : null,
            imageUrl: await resolveArtworkImageUrl(row.imageUrl, row.imageKey),
          })),
        );

        const featuredMap = new Map<number, number>();
        settings.featuredArtworkIds.forEach((id, index) => featuredMap.set(Number(id), index));

        normalizedGalleryRows.sort((left: any, right: any) => {
          const leftIndex = featuredMap.has(Number(left.id)) ? Number(featuredMap.get(Number(left.id))) : Number.MAX_SAFE_INTEGER;
          const rightIndex = featuredMap.has(Number(right.id)) ? Number(featuredMap.get(Number(right.id))) : Number.MAX_SAFE_INTEGER;
          if (leftIndex !== rightIndex) return leftIndex - rightIndex;
          if (Boolean(left.isFeatured) !== Boolean(right.isFeatured)) return Number(Boolean(right.isFeatured)) - Number(Boolean(left.isFeatured));
          return new Date(String(right.createdAt || "")).getTime() - new Date(String(left.createdAt || "")).getTime();
        });

        return {
          status: "ok" as const,
          teacher: { id: teacherRow.id, name: teacherRow.name || null, avatarUrl: null as string | null },
          settings,
          artworks: normalizedGalleryRows,
        };
      }),

    // الحصول على معرض معلم محدد (عام)
    getTeacherGallery: publicProcedure
      .input(z.object({ teacherId: z.number() }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) {
          return {
            teacher: { id: input.teacherId, name: null, avatarUrl: null as string | null },
            settings: buildDefaultTeacherGallerySettings(),
            artworks: [],
          };
        }

        const teacherRows = await db
          .select({ id: users.id, name: users.name })
          .from(users)
          .where(eq(users.id, input.teacherId))
          .limit(1);

        const teacher = teacherRows[0]
          ? { id: teacherRows[0].id, name: teacherRows[0].name, avatarUrl: null as string | null }
          : { id: input.teacherId, name: null, avatarUrl: null as string | null };

        const fallbackSettings = buildDefaultTeacherGallerySettings(teacher.name);
        let settingRows: any[] = [];
        try {
          settingRows = await db
            .select()
            .from(teacherGallerySettings)
            .where(eq(teacherGallerySettings.teacherId, input.teacherId))
            .limit(1);
        } catch (error) {
          if (!isMissingGallerySettingsSchemaError(error)) throw error;
        }

        const settingRow = settingRows[0];
        const settings = settingRow
          ? {
              enabled: Boolean(settingRow.enabled),
              heroTitle: settingRow.heroTitle || fallbackSettings.heroTitle,
              heroDescription: settingRow.heroDescription || fallbackSettings.heroDescription,
              headerImageUrl: settingRow.headerImageUrl || "",
              featuredArtworkIds: parseNumberArrayJson(settingRow.featuredArtworkIdsJson),
              imageErrorTitle: settingRow.imageErrorTitle || fallbackSettings.imageErrorTitle,
              imageErrorDescription: settingRow.imageErrorDescription || fallbackSettings.imageErrorDescription,
              visibility: normalizeGalleryVisibility(settingRow.visibility, fallbackSettings.visibility),
              shareSlug: String(settingRow.shareSlug || "").trim(),
              shareEnabled:
                typeof settingRow.shareEnabled === "undefined"
                  ? fallbackSettings.shareEnabled
                  : Boolean(settingRow.shareEnabled),
              showArtistName:
                typeof settingRow.showArtistName === "undefined"
                  ? fallbackSettings.showArtistName
                  : Boolean(settingRow.showArtistName),
              allowPublicViewing:
                typeof settingRow.allowPublicViewing === "undefined"
                  ? fallbackSettings.allowPublicViewing
                  : Boolean(settingRow.allowPublicViewing),
              slideshowEnabled:
                typeof settingRow.slideshowEnabled === "undefined"
                  ? fallbackSettings.slideshowEnabled
                  : Boolean(settingRow.slideshowEnabled),
              slideshowIntervalSeconds: normalizeSlideshowIntervalSeconds(
                settingRow.slideshowIntervalSeconds,
                fallbackSettings.slideshowIntervalSeconds,
              ),
              slideshowShowDetails:
                typeof settingRow.slideshowShowDetails === "undefined"
                  ? fallbackSettings.slideshowShowDetails
                  : Boolean(settingRow.slideshowShowDetails),
            }
          : fallbackSettings;

        const galleryRows = await db
          .select({
            id: artworks.id,
            imageUrl: artworks.imageUrl,
            imageKey: artworks.imageKey,
            title: artworks.title,
            studentName: users.name,
            className: classes.name,
            createdAt: artworks.createdAt,
            isFeatured: artworks.isFeatured,
            status: artworks.status,
            competitionId: artworks.competitionId,
            competitionVotes: artworks.competitionVotes,
            competitionPlace: sql<CompetitionPlace>`(
              case
                when artworks.competitionId is null then null
                when artworks.id = (
                  select c.firstPlaceArtworkId
                  from competitions c
                  where c.id = artworks.competitionId
                  limit 1
                ) then 'first'
                when artworks.id = (
                  select c.secondPlaceArtworkId
                  from competitions c
                  where c.id = artworks.competitionId
                  limit 1
                ) then 'second'
                when artworks.id = (
                  select c.thirdPlaceArtworkId
                  from competitions c
                  where c.id = artworks.competitionId
                  limit 1
                ) then 'third'
                else null
              end
            )`,
          })
          .from(artworks)
          .innerJoin(classes, eq(artworks.classId, classes.id))
          .leftJoin(users, eq(artworks.studentId, users.id))
          .where(
            and(
              eq(classes.teacherId, input.teacherId),
              eq(artworks.showInTeacherGallery, true),
              eq(artworks.isPublic, true),
              inArray(artworks.status, ["submitted", "reviewed", "published"]),
            ),
          )
          .orderBy(desc(artworks.isFeatured), desc(artworks.createdAt))
          .limit(100);

        const normalizedGalleryRows = await Promise.all(
          galleryRows.map(async (row: any) => ({
            ...row,
            imageUrl: await resolveArtworkImageUrl(row.imageUrl, row.imageKey),
          })),
        );

        const featuredMap = new Map<number, number>();
        settings.featuredArtworkIds.forEach((id, index) => featuredMap.set(Number(id), index));

        normalizedGalleryRows.sort((left: any, right: any) => {
          const leftIndex = featuredMap.has(Number(left.id)) ? Number(featuredMap.get(Number(left.id))) : Number.MAX_SAFE_INTEGER;
          const rightIndex = featuredMap.has(Number(right.id)) ? Number(featuredMap.get(Number(right.id))) : Number.MAX_SAFE_INTEGER;
          if (leftIndex !== rightIndex) return leftIndex - rightIndex;
          if (Boolean(left.isFeatured) !== Boolean(right.isFeatured)) return Number(Boolean(right.isFeatured)) - Number(Boolean(left.isFeatured));
          return new Date(String(right.createdAt || "")).getTime() - new Date(String(left.createdAt || "")).getTime();
        });

        return {
          teacher,
          settings,
          artworks: settings.enabled ? normalizedGalleryRows : [],
        };
      }),

    getMyTeacherGallerySettings: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role !== "teacher" && ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      const database = await getDb();
      if (!database) {
        return buildDefaultTeacherGallerySettings(ctx.user.name || null);
      }

      let rows: any[] = [];
      try {
        rows = await database
          .select()
          .from(teacherGallerySettings)
          .where(eq(teacherGallerySettings.teacherId, ctx.user.id))
          .limit(1);
      } catch (error) {
        if (!isMissingGallerySettingsSchemaError(error)) throw error;
      }

      const fallback = buildDefaultTeacherGallerySettings(ctx.user.name || null);
      const row = rows[0];
      if (!row) return fallback;

      return {
        enabled: Boolean(row.enabled),
        heroTitle: row.heroTitle || fallback.heroTitle,
        heroDescription: row.heroDescription || fallback.heroDescription,
        headerImageUrl: row.headerImageUrl || "",
        featuredArtworkIds: parseNumberArrayJson(row.featuredArtworkIdsJson),
        imageErrorTitle: row.imageErrorTitle || fallback.imageErrorTitle,
        imageErrorDescription: row.imageErrorDescription || fallback.imageErrorDescription,
        visibility: normalizeGalleryVisibility(row.visibility, fallback.visibility),
        shareSlug: String(row.shareSlug || "").trim(),
        shareEnabled: typeof row.shareEnabled === "undefined" ? fallback.shareEnabled : Boolean(row.shareEnabled),
        showArtistName: typeof row.showArtistName === "undefined" ? fallback.showArtistName : Boolean(row.showArtistName),
        allowPublicViewing:
          typeof row.allowPublicViewing === "undefined"
            ? fallback.allowPublicViewing
            : Boolean(row.allowPublicViewing),
        slideshowEnabled: typeof row.slideshowEnabled === "undefined" ? fallback.slideshowEnabled : Boolean(row.slideshowEnabled),
        slideshowIntervalSeconds: normalizeSlideshowIntervalSeconds(row.slideshowIntervalSeconds, fallback.slideshowIntervalSeconds),
        slideshowShowDetails:
          typeof row.slideshowShowDetails === "undefined" ? fallback.slideshowShowDetails : Boolean(row.slideshowShowDetails),
      };
    }),

    updateMyTeacherGallerySettings: protectedProcedure
      .input(
        z.object({
          enabled: z.boolean(),
          heroTitle: z.string().min(3).max(255),
          heroDescription: z.string().min(3).max(5000),
          headerImageUrl: z.string().max(5000).optional(),
          featuredArtworkIds: z.array(z.number().int().positive()).max(200),
          imageErrorTitle: z.string().min(3).max(255),
          imageErrorDescription: z.string().min(3).max(5000),
          visibility: z.enum(GALLERY_VISIBILITY_VALUES).default("private"),
          shareEnabled: z.boolean().default(false),
          showArtistName: z.boolean().default(true),
          allowPublicViewing: z.boolean().default(false),
          slideshowEnabled: z.boolean().default(true),
          slideshowIntervalSeconds: z.number().int().min(3).max(15).default(5),
          slideshowShowDetails: z.boolean().default(false),
        })
      )
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "teacher" && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN" });
        }

        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const payload = {
          teacherId: ctx.user.id,
          enabled: input.enabled,
          heroTitle: input.heroTitle.trim(),
          heroDescription: input.heroDescription.trim(),
          headerImageUrl: String(input.headerImageUrl || "").trim(),
          featuredArtworkIdsJson: JSON.stringify(Array.from(new Set(input.featuredArtworkIds))),
          imageErrorTitle: input.imageErrorTitle.trim(),
          imageErrorDescription: input.imageErrorDescription.trim(),
          visibility: normalizeGalleryVisibility(input.visibility),
          shareSlug: "",
          shareEnabled: Boolean(input.shareEnabled),
          showArtistName: Boolean(input.showArtistName),
          allowPublicViewing: Boolean(input.allowPublicViewing),
          slideshowEnabled: input.slideshowEnabled,
          slideshowIntervalSeconds: normalizeSlideshowIntervalSeconds(input.slideshowIntervalSeconds),
          slideshowShowDetails: input.slideshowShowDetails,
          updatedAt: new Date(),
        };

        let existingShareSlug = "";
        try {
          const existingRows = await database
            .select({ shareSlug: teacherGallerySettings.shareSlug })
            .from(teacherGallerySettings)
            .where(eq(teacherGallerySettings.teacherId, ctx.user.id))
            .limit(1);
          existingShareSlug = String(existingRows[0]?.shareSlug || "").trim();
        } catch (error) {
          if (!isMissingGallerySettingsSchemaError(error)) throw error;
        }

        payload.shareSlug = existingShareSlug || buildRandomShareSlug("t");

        try {
          await database
            .insert(teacherGallerySettings)
            .values(payload)
            .onDuplicateKeyUpdate({
              set: {
                enabled: payload.enabled,
                heroTitle: payload.heroTitle,
                heroDescription: payload.heroDescription,
                headerImageUrl: payload.headerImageUrl,
                featuredArtworkIdsJson: payload.featuredArtworkIdsJson,
                imageErrorTitle: payload.imageErrorTitle,
                imageErrorDescription: payload.imageErrorDescription,
                visibility: payload.visibility,
                shareSlug: payload.shareSlug,
                shareEnabled: payload.shareEnabled,
                showArtistName: payload.showArtistName,
                allowPublicViewing: payload.allowPublicViewing,
                slideshowEnabled: payload.slideshowEnabled,
                slideshowIntervalSeconds: payload.slideshowIntervalSeconds,
                slideshowShowDetails: payload.slideshowShowDetails,
                updatedAt: new Date(),
              },
            });
        } catch (error) {
          if (!isMissingGallerySettingsSchemaError(error)) throw error;

          const legacyPayload = withoutGallerySharingFields(withoutGallerySlideshowFields(payload));
          await database
            .insert(teacherGallerySettings)
            .values(legacyPayload as any)
            .onDuplicateKeyUpdate({
              set: {
                enabled: payload.enabled,
                heroTitle: payload.heroTitle,
                heroDescription: payload.heroDescription,
                headerImageUrl: payload.headerImageUrl,
                featuredArtworkIdsJson: payload.featuredArtworkIdsJson,
                imageErrorTitle: payload.imageErrorTitle,
                imageErrorDescription: payload.imageErrorDescription,
                updatedAt: new Date(),
              } as any,
            });
        }

        return { success: true };
      }),

    regenerateMyTeacherGalleryShareLink: protectedProcedure.mutation(async ({ ctx }) => {
      if (ctx.user.role !== "teacher" && ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      const database = await getDb();
      if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const nextSlug = buildRandomShareSlug("t");
      const defaults = buildDefaultTeacherGallerySettings(ctx.user.name || null);
      try {
        await database
          .insert(teacherGallerySettings)
          .values({
            teacherId: ctx.user.id,
            enabled: defaults.enabled,
            heroTitle: defaults.heroTitle,
            heroDescription: defaults.heroDescription,
            headerImageUrl: defaults.headerImageUrl,
            featuredArtworkIdsJson: JSON.stringify(defaults.featuredArtworkIds),
            imageErrorTitle: defaults.imageErrorTitle,
            imageErrorDescription: defaults.imageErrorDescription,
            shareSlug: nextSlug,
            shareEnabled: true,
            visibility: "unlisted",
            showArtistName: defaults.showArtistName,
            allowPublicViewing: true,
            slideshowEnabled: defaults.slideshowEnabled,
            slideshowIntervalSeconds: defaults.slideshowIntervalSeconds,
            slideshowShowDetails: defaults.slideshowShowDetails,
            updatedAt: new Date(),
          } as any)
          .onDuplicateKeyUpdate({
            set: {
              shareSlug: nextSlug,
              shareEnabled: true,
              visibility: "unlisted",
              allowPublicViewing: true,
              updatedAt: new Date(),
            } as any,
          });
      } catch (error) {
        if (!isMissingGallerySettingsSchemaError(error)) throw error;
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "تحتاج قاعدة البيانات إلى ترحيل إعدادات المشاركة العامة" });
      }

      return { shareSlug: nextSlug };
    }),

    disableMyTeacherGalleryShareLink: protectedProcedure.mutation(async ({ ctx }) => {
      if (ctx.user.role !== "teacher" && ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      const database = await getDb();
      if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      try {
        const defaults = buildDefaultTeacherGallerySettings(ctx.user.name || null);
        await database
          .insert(teacherGallerySettings)
          .values({
            teacherId: ctx.user.id,
            enabled: defaults.enabled,
            heroTitle: defaults.heroTitle,
            heroDescription: defaults.heroDescription,
            headerImageUrl: defaults.headerImageUrl,
            featuredArtworkIdsJson: JSON.stringify(defaults.featuredArtworkIds),
            imageErrorTitle: defaults.imageErrorTitle,
            imageErrorDescription: defaults.imageErrorDescription,
            shareSlug: "",
            shareEnabled: false,
            visibility: "private",
            showArtistName: defaults.showArtistName,
            allowPublicViewing: false,
            slideshowEnabled: defaults.slideshowEnabled,
            slideshowIntervalSeconds: defaults.slideshowIntervalSeconds,
            slideshowShowDetails: defaults.slideshowShowDetails,
            updatedAt: new Date(),
          } as any)
          .onDuplicateKeyUpdate({
            set: {
              shareEnabled: false,
              visibility: "private",
              allowPublicViewing: false,
              updatedAt: new Date(),
            } as any,
          });
      } catch (error) {
        if (!isMissingGallerySettingsSchemaError(error)) throw error;
      }

      return { success: true };
    }),

    // حفظ عمل فني جديد
    create: protectedProcedure
      .input(z.object({
        title: z.string().min(1),
        description: z.string().optional(),
        imageData: z.string(), // base64 image data
        classId: z.number().optional(),
        lessonId: z.number().optional(),
        isPublic: z.boolean().default(false),
      }))
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const normalizedTitle = input.title.trim();
        if (!normalizedTitle) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "عنوان العمل مطلوب" });
        }

        const isStudent = ctx.user.role === "student" || ctx.user.role === "user";
        if (!isStudent && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "غير مصرح لك برفع الأعمال الفنية" });
        }

        let resolvedClassId = input.classId;
        if (isStudent && input.classId) {
          const membership = await db
            .select()
            .from(classStudents)
            .where(
              and(
                eq(classStudents.classId, input.classId),
                eq(classStudents.studentId, ctx.user.id)
              )
            )
            .limit(1);

          if (!membership[0]) {
            throw new TRPCError({ code: "FORBIDDEN", message: "لا يمكنك الرفع على فصل غير منضم إليه" });
          }
        }

        if (isStudent && !resolvedClassId) {
          const latestEnrollment = await db
            .select({ classId: classStudents.classId })
            .from(classStudents)
            .where(eq(classStudents.studentId, ctx.user.id))
            .orderBy(desc(classStudents.joinedAt))
            .limit(1);

          resolvedClassId = latestEnrollment[0]?.classId;
        }

        if (isStudent && !resolvedClassId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "لا يمكن رفع العمل بدون فصل. الرجاء الانضمام إلى فصل أولاً.",
          });
        }

        // تحويل base64 إلى buffer مع استخراج النوع الفعلي من data URL
        const imageDataMatch = input.imageData.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/);
        if (!imageDataMatch) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "بيانات الصورة غير صالحة" });
        }

        const contentType = String(imageDataMatch[1]).toLowerCase();
        const base64Data = imageDataMatch[2] || "";
        if (!contentType.startsWith("image/")) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "نوع الملف غير مدعوم" });
        }

        const buffer = Buffer.from(base64Data, "base64");
        const extension = contentType === "image/jpeg" ? "jpg" : contentType.replace("image/", "");

        // رفع الصورة إلى S3
        const originalName = `artworks/artwork-${ctx.user.id}.${extension}`;
        const uploaded = await storagePut(originalName, buffer, contentType);
        if (!uploaded?.url || !uploaded?.key) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "تعذر رفع صورة العمل" });
        }

        // حفظ البيانات في قاعدة البيانات
        const result = await db.insert(artworks).values({
          studentId: ctx.user.id,
          classId: resolvedClassId ?? null,
          title: normalizedTitle,
          description: input.description,
          imageUrl: uploaded.url,
          imageKey: uploaded.key,
          lessonId: input.lessonId ?? null,
          status: ctx.user.role === "admin" && input.isPublic ? "published" : "submitted",
          isPublic: ctx.user.role === "admin" ? input.isPublic : false,
          isFeatured: false,
          showInClassGallery: true,
          // Teacher gallery visibility is opt-in by teacher action from class artworks page.
          showInTeacherGallery: false,
          showInSiteGallery: false,
          showInStudentPublicGallery: true,
          showInCompetition: false,
        });

        // Drizzle/MySQL return shape can vary by runtime; normalize insertId safely.
        const insertIdRaw =
          (result as { insertId?: unknown } | undefined)?.insertId ??
          (Array.isArray(result)
            ? (result[0] as { insertId?: unknown } | undefined)?.insertId
            : undefined);

        const parsedInsertId = Number(insertIdRaw);
        let artworkId = Number.isFinite(parsedInsertId) && parsedInsertId > 0
          ? parsedInsertId
          : null;

        if (!artworkId) {
          const insertedRow = await db
            .select({ id: artworks.id })
            .from(artworks)
            .where(eq(artworks.imageKey, uploaded.key))
            .orderBy(desc(artworks.id))
            .limit(1);

          artworkId = insertedRow[0]?.id ?? null;
        }

        if (!artworkId) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "تعذر تحديد معرف العمل بعد الحفظ" });
        }

        // تحقق نهائي من الأعمدة الأساسية التي يعتمد عليها النظام كله.
        const persistedRows = await db
          .select({
            id: artworks.id,
            title: artworks.title,
            imageUrl: artworks.imageUrl,
            studentId: artworks.studentId,
            classId: artworks.classId,
            lessonId: artworks.lessonId,
          })
          .from(artworks)
          .where(eq(artworks.id, artworkId))
          .limit(1);

        const persisted = persistedRows[0];
        if (!persisted) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "تم الحفظ لكن تعذر قراءة سجل العمل" });
        }

        const expectedLessonId = input.lessonId ?? null;
        const lessonIdMatches = (persisted.lessonId ?? null) === expectedLessonId;
        const classIdIsValid = isStudent ? persisted.classId !== null : true;
        const coreFieldsValid =
          Boolean(persisted.title?.trim()) &&
          Boolean(persisted.imageUrl?.trim()) &&
          persisted.studentId === ctx.user.id &&
          classIdIsValid &&
          lessonIdMatches;

        if (!coreFieldsValid) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "فشل التحقق من حفظ بيانات العمل الأساسية",
          });
        }

        const artworkAssetId = await registerInternalAsset(db, {
          provider: "spaces",
          bucket: uploaded.bucket,
          objectKey: uploaded.key,
          publicUrl: uploaded.url,
          mimeType: contentType,
          fileSize: buffer.length,
          sourceType: "artwork_image",
          ownershipContext: `artwork:${persisted.id}`,
        });

        await replaceEntityAssetReferenceByUrl(db, {
          entityType: "artworks",
          entityId: persisted.id,
          fieldName: "imageUrl",
          publicUrl: uploaded.url,
          sourceType: "artwork_image",
          ownershipContext: `artwork:${persisted.id}`,
        });

        console.info("[assets] artwork upload linked", {
          artworkId: persisted.id,
          assetId: artworkAssetId,
          key: uploaded.key,
        });

        // تحديث نقاط الطالب
        const existingPoints = await db.select().from(studentPoints)
          .where(eq(studentPoints.studentId, ctx.user.id))
          .limit(1);

        if (existingPoints.length > 0) {
          await db.update(studentPoints)
            .set({
              totalPoints: (existingPoints[0].totalPoints || 0) + 10,
              artworksCount: (existingPoints[0].artworksCount || 0) + 1,
            })
            .where(eq(studentPoints.studentId, ctx.user.id));
        } else {
          await db.insert(studentPoints).values({
            studentId: ctx.user.id,
            totalPoints: 10,
            artworksCount: 1,
            challengesCompleted: 0,
          });
        }

        if (isStudent) {
          await maybeAwardFirstArtwork(ctx.user.id);
        }

        return {
          success: true,
          artworkId: persisted.id,
          imageUrl: uploaded.url,
          url: uploaded.url,
          key: uploaded.key,
          bucket: uploaded.bucket,
          classId: resolvedClassId,
        };
      }),

    setPublicStatus: protectedProcedure
      .input(
        z.object({
          artworkId: z.number(),
          isPublic: z.boolean(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        if (ctx.user.role !== "teacher" && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "المعلم أو الإدارة فقط يمكنهم اعتماد الأعمال" });
        }

        const target = await db
          .select()
          .from(artworks)
          .where(eq(artworks.id, input.artworkId))
          .limit(1);

        const artwork = target[0];
        if (!artwork) {
          throw new TRPCError({ code: "NOT_FOUND", message: "العمل الفني غير موجود" });
        }

        if (ctx.user.role === "teacher") {
          if (!artwork.classId) {
            throw new TRPCError({ code: "FORBIDDEN", message: "لا يمكن اعتماد عمل غير مرتبط بفصل" });
          }

          const classRow = await db
            .select({ teacherId: classes.teacherId })
            .from(classes)
            .where(eq(classes.id, artwork.classId))
            .limit(1);

          if (!classRow[0] || classRow[0].teacherId !== ctx.user.id) {
            throw new TRPCError({ code: "FORBIDDEN", message: "غير مصرح لك باعتماد هذا العمل" });
          }
        }

        await db
          .update(artworks)
          .set({
            isPublic: input.isPublic,
            status: input.isPublic ? "published" : "reviewed",
            isFeatured: input.isPublic ? artwork.isFeatured : false,
          })
          .where(eq(artworks.id, input.artworkId));

        const wasPublished = artwork.status === "published" && artwork.isPublic === true;
        const becamePublished = input.isPublic && !wasPublished;
        const becameFeaturedWhilePublished = input.isPublic && artwork.isFeatured === true;

        if (becamePublished) {
          await maybeAwardFirstPublishedArtwork(artwork.studentId);
        }
        if (becameFeaturedWhilePublished) {
          await maybeAwardFeaturedArtist(artwork.studentId);
        }

        return { success: true };
      }),

    setTeacherGalleryVisibility: protectedProcedure
      .input(
        z.object({
          artworkId: z.number(),
          showInTeacherGallery: z.boolean(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        if (ctx.user.role !== "teacher" && ctx.user.role !== "admin") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "المعلم أو الإدارة فقط يمكنهم تعديل ظهور العمل في معرض المعلم",
          });
        }

        const target = await db
          .select({ id: artworks.id, classId: artworks.classId })
          .from(artworks)
          .where(eq(artworks.id, input.artworkId))
          .limit(1);

        const artwork = target[0];
        if (!artwork) {
          throw new TRPCError({ code: "NOT_FOUND", message: "العمل الفني غير موجود" });
        }

        if (ctx.user.role === "teacher") {
          if (!artwork.classId) {
            throw new TRPCError({ code: "FORBIDDEN", message: "لا يمكن تعديل عمل غير مرتبط بفصل" });
          }

          const classRow = await db
            .select({ teacherId: classes.teacherId })
            .from(classes)
            .where(eq(classes.id, artwork.classId))
            .limit(1);

          if (!classRow[0] || classRow[0].teacherId !== ctx.user.id) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "غير مصرح لك بتعديل ظهور هذا العمل في معرض المعلم",
            });
          }
        }

        await db
          .update(artworks)
          .set({ showInTeacherGallery: input.showInTeacherGallery })
          .where(eq(artworks.id, input.artworkId));

        return { success: true };
      }),

    setSiteGalleryVisibility: protectedProcedure
      .input(
        z.object({
          artworkId: z.number(),
          showInSiteGallery: z.boolean(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        if (ctx.user.role !== "admin") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "الإدارة فقط يمكنها تعديل ظهور العمل في معرض الموقع",
          });
        }

        const target = await db
          .select({ id: artworks.id })
          .from(artworks)
          .where(eq(artworks.id, input.artworkId))
          .limit(1);

        if (!target[0]) {
          throw new TRPCError({ code: "NOT_FOUND", message: "العمل الفني غير موجود" });
        }

        await db
          .update(artworks)
          .set({ showInSiteGallery: input.showInSiteGallery })
          .where(eq(artworks.id, input.artworkId));

        return { success: true };
      }),

    voteForArtwork: protectedProcedure
      .input(
        z.object({
          artworkId: z.number(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const artworkRows = await database
          .select({
            id: artworks.id,
            competitionId: artworks.competitionId,
            showInCompetition: artworks.showInCompetition,
            isPublic: artworks.isPublic,
            status: artworks.status,
            competitionVotes: artworks.competitionVotes,
          })
          .from(artworks)
          .where(eq(artworks.id, input.artworkId))
          .limit(1);

        const artwork = artworkRows[0];
        if (!artwork) {
          throw new TRPCError({ code: "NOT_FOUND", message: "العمل الفني غير موجود" });
        }

        if (!artwork.competitionId || !artwork.showInCompetition) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "هذا العمل غير مشارك في مسابقة" });
        }

        if (artwork.status === "draft" || !artwork.isPublic) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "لا يمكن التصويت على هذا العمل حاليًا" });
        }

        const competitionRows = await database
          .select({ id: competitions.id, isActive: competitions.isActive, startDate: competitions.startDate, endDate: competitions.endDate })
          .from(competitions)
          .where(eq(competitions.id, artwork.competitionId))
          .limit(1);

        const competition = competitionRows[0];
        if (!competition) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "المسابقة المرتبطة بالعمل غير موجودة" });
        }

        const now = new Date();
        const withinWindow = competition.startDate <= now && competition.endDate >= now;
        if (!competition.isActive || !withinWindow) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "التصويت غير متاح حاليًا لهذه المسابقة" });
        }

        const existingVote = await database
          .select({ id: competitionArtworkVotes.id })
          .from(competitionArtworkVotes)
          .where(
            and(
              eq(competitionArtworkVotes.competitionId, artwork.competitionId),
              eq(competitionArtworkVotes.artworkId, artwork.id),
              eq(competitionArtworkVotes.userId, ctx.user.id)
            )
          )
          .limit(1);

        if (existingVote[0]) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "لقد صوتت على هذا العمل مسبقًا" });
        }

        await database.insert(competitionArtworkVotes).values({
          competitionId: artwork.competitionId,
          artworkId: artwork.id,
          userId: ctx.user.id,
        });

        const nextVotes = (artwork.competitionVotes || 0) + 1;
        await database
          .update(artworks)
          .set({ competitionVotes: nextVotes })
          .where(eq(artworks.id, artwork.id));

        return { success: true, competitionVotes: nextVotes };
      }),

    updateWorkflow: protectedProcedure
      .input(
        z.object({
          artworkId: z.number(),
          status: z.enum(["draft", "submitted", "reviewed", "published"]).optional(),
          isFeatured: z.boolean().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        if (ctx.user.role !== "teacher" && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "المعلم أو الإدارة فقط يمكنهم تحديث حالة العمل" });
        }

        const target = await db
          .select()
          .from(artworks)
          .where(eq(artworks.id, input.artworkId))
          .limit(1);

        const artwork = target[0];
        if (!artwork) {
          throw new TRPCError({ code: "NOT_FOUND", message: "العمل الفني غير موجود" });
        }

        if (ctx.user.role === "teacher") {
          if (!artwork.classId) {
            throw new TRPCError({ code: "FORBIDDEN", message: "لا يمكن تعديل عمل غير مرتبط بفصل" });
          }

          const classRow = await db
            .select({ teacherId: classes.teacherId })
            .from(classes)
            .where(eq(classes.id, artwork.classId))
            .limit(1);

          if (!classRow[0] || classRow[0].teacherId !== ctx.user.id) {
            throw new TRPCError({ code: "FORBIDDEN", message: "غير مصرح لك بتعديل هذا العمل" });
          }
        }

        const nextStatus = input.status ?? artwork.status;
        const nextIsFeatured = input.isFeatured ?? artwork.isFeatured;
        const shouldBePublic = nextStatus === "published";
        const wasPublished = artwork.status === "published" && artwork.isPublic === true;
        const becamePublished = shouldBePublic && !wasPublished;
        const becameFeatured = shouldBePublic && nextIsFeatured && !artwork.isFeatured;

        await db
          .update(artworks)
          .set({
            status: nextStatus,
            isPublic: shouldBePublic,
            isFeatured: shouldBePublic ? nextIsFeatured : false,
          })
          .where(eq(artworks.id, input.artworkId));

        if (becamePublished) {
          await maybeAwardFirstPublishedArtwork(artwork.studentId);
        }
        if (becameFeatured) {
          await maybeAwardFeaturedArtist(artwork.studentId);
        }

        return { success: true };
      }),

    // حذف عمل فني
    delete: protectedProcedure
      .input(z.object({ artworkId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const artworkRows = await db.select().from(artworks)
          .where(eq(artworks.id, input.artworkId))
          .limit(1);
        const artwork = artworkRows[0];

        if (!artwork) {
          throw new TRPCError({ code: "NOT_FOUND", message: "العمل الفني غير موجود" });
        }

        const isOwner = artwork.studentId === ctx.user.id;
        const isAdmin = ctx.user.role === "admin";
        let isTeacherOwner = false;

        if (ctx.user.role === "teacher" && artwork.classId) {
          const classRow = await db
            .select({ teacherId: classes.teacherId })
            .from(classes)
            .where(eq(classes.id, artwork.classId))
            .limit(1);
          isTeacherOwner = classRow[0]?.teacherId === ctx.user.id;
        }

        if (!isOwner && !isTeacherOwner && !isAdmin) {
          throw new TRPCError({ code: "FORBIDDEN", message: "غير مصرح لك بحذف هذا العمل" });
        }

        await detachEntityAssetReferences(db, {
          entityType: "artworks",
          entityId: input.artworkId,
        });

        // Legacy fallback for records that predate uploadedAssets tracking.
        if (artwork.imageKey) {
          const trackedAsset = await db
            .select({ id: uploadedAssets.id })
            .from(uploadedAssets)
            .where(eq(uploadedAssets.objectKey, artwork.imageKey))
            .limit(1);

          if (!trackedAsset[0]) {
            await storageDelete(artwork.imageKey);
          }
        }

        await db.delete(artworkAiFeedback).where(eq(artworkAiFeedback.artworkId, input.artworkId));
        await db.delete(challengeSubmissions).where(eq(challengeSubmissions.artworkId, input.artworkId));
        await db.delete(artworkVotes).where(eq(artworkVotes.artworkId, input.artworkId));
        await db.delete(artworks).where(eq(artworks.id, input.artworkId));

        return { success: true };
      }),
  }),

  // نظام النقاط والشارات
  achievements: router({
    // الحصول على نقاط الطالب
    getMyPoints: protectedProcedure.query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) return null;

      const result = await db.select().from(studentPoints)
        .where(eq(studentPoints.studentId, ctx.user.id))
        .limit(1);

      return result[0] || { totalPoints: 0, artworksCount: 0, challengesCompleted: 0 };
    }),

    // الحصول على شارات الطالب
    getMyBadges: protectedProcedure.query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) return [];

      return db.select({
        badge: badges,
        earnedAt: studentBadges.earnedAt,
      })
      .from(studentBadges)
      .innerJoin(badges, eq(studentBadges.badgeId, badges.id))
      .where(eq(studentBadges.studentId, ctx.user.id));
    }),

    // الحصول على لوحة المتصدرين
    getLeaderboard: publicProcedure
      .input(z.object({ limit: z.number().default(10) }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) return [];

        return db.select().from(studentPoints)
          .orderBy(desc(studentPoints.totalPoints))
          .limit(input.limit);
      }),
  }),

  badges: router({
    publicList: publicProcedure.query(async () => {
      const database = await getDb();
      if (!database) return [];

      return database
        .select()
        .from(badges)
        .where(eq(badges.isVisible, true))
        .orderBy(desc(badges.createdAt));
    }),

    list: protectedProcedure
      .input(
        z.object({
          includeHidden: z.boolean().default(false),
        }).optional()
      )
      .query(async ({ ctx, input }) => {
        const database = await getDb();
        if (!database) return [];

        const includeHidden = Boolean(input?.includeHidden);
        if (ctx.user.role === "admin" && includeHidden) {
          return database.select().from(badges).orderBy(desc(badges.createdAt));
        }

        return database
          .select()
          .from(badges)
          .where(eq(badges.isVisible, true))
          .orderBy(desc(badges.createdAt));
      }),

    create: protectedProcedure
      .input(
        z.object({
          name: z.string().min(1),
          description: z.string().optional(),
          iconUrl: z.string().optional(),
          category: z.enum(["artwork", "participation", "challenge", "special"]),
          requirement: z.number().int().positive().default(1),
          isVisible: z.boolean().default(true),
        })
      )
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "الإدارة فقط يمكنها إنشاء الشارات" });
        }

        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const existing = await database
          .select({ id: badges.id })
          .from(badges)
          .where(eq(badges.name, input.name.trim()))
          .limit(1);

        if (existing[0]) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "يوجد شارة بنفس الاسم" });
        }

        const normalizedIconUrl = normalizeBadgeIconValue(input.iconUrl);

        const inserted: any = await database.insert(badges).values({
          name: input.name.trim(),
          description: input.description,
          iconUrl: normalizedIconUrl,
          category: input.category,
          requirement: input.requirement,
          isVisible: input.isVisible,
        });

        const badgeId = Number(inserted?.insertId || inserted?.[0]?.insertId || 0);
        if (badgeId > 0 && isValidHttpUrl(normalizedIconUrl)) {
          await replaceEntityAssetReferenceByUrl(database, {
            entityType: "badges",
            entityId: badgeId,
            fieldName: "iconUrl",
            publicUrl: normalizedIconUrl,
            sourceType: "badge_icon",
            ownershipContext: `badge:${badgeId}`,
          });
        }

        return { success: true };
      }),

    update: protectedProcedure
      .input(
        z.object({
          badgeId: z.number(),
          name: z.string().min(1),
          description: z.string().optional(),
          iconUrl: z.string().optional(),
          category: z.enum(["artwork", "participation", "challenge", "special"]),
          requirement: z.number().int().positive().default(1),
          isVisible: z.boolean(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "الإدارة فقط يمكنها تعديل الشارات" });
        }

        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const duplicate = await database
          .select({ id: badges.id })
          .from(badges)
          .where(and(eq(badges.name, input.name.trim()), sql`${badges.id} <> ${input.badgeId}`))
          .limit(1);

        if (duplicate[0]) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "يوجد شارة أخرى بنفس الاسم" });
        }

        const normalizedIconUrl = normalizeBadgeIconValue(input.iconUrl);

        await database
          .update(badges)
          .set({
            name: input.name.trim(),
            description: input.description,
            iconUrl: normalizedIconUrl,
            category: input.category,
            requirement: input.requirement,
            isVisible: input.isVisible,
          })
          .where(eq(badges.id, input.badgeId));

        await replaceEntityAssetReferenceByUrl(database, {
          entityType: "badges",
          entityId: input.badgeId,
          fieldName: "iconUrl",
          publicUrl: isValidHttpUrl(normalizedIconUrl) ? normalizedIconUrl : null,
          sourceType: "badge_icon",
          ownershipContext: `badge:${input.badgeId}`,
        });

        return { success: true };
      }),

    setVisibility: protectedProcedure
      .input(
        z.object({
          badgeId: z.number(),
          isVisible: z.boolean(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "الإدارة فقط يمكنها إخفاء/إظهار الشارات" });
        }

        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        await database
          .update(badges)
          .set({ isVisible: input.isVisible })
          .where(eq(badges.id, input.badgeId));

        return { success: true };
      }),

    delete: protectedProcedure
      .input(z.object({ badgeId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "الإدارة فقط يمكنها حذف الشارات" });
        }

        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        await detachEntityAssetReferences(database, {
          entityType: "badges",
          entityId: input.badgeId,
        });

        await database.delete(studentBadges).where(eq(studentBadges.badgeId, input.badgeId));
        await database.delete(badges).where(eq(badges.id, input.badgeId));

        return { success: true };
      }),

    uploadIcon: protectedProcedure
      .input(
        z.object({
          imageData: z.string(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "الإدارة فقط يمكنها رفع صور الشارات" });
        }

        const base64Data = input.imageData.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, "");
        const buffer = Buffer.from(base64Data, "base64");
        const uploaded = await storagePut(`badges/badge-${Date.now()}.png`, buffer, "image/png");

        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const assetId = await registerInternalAsset(database, {
          provider: "spaces",
          bucket: uploaded.bucket,
          objectKey: uploaded.key,
          publicUrl: uploaded.url,
          mimeType: "image/png",
          fileSize: buffer.length,
          sourceType: "badge_icon_upload",
          ownershipContext: "badge",
        });

        if (!uploaded?.url) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "تعذر رفع صورة الشارة" });
        }

        return { success: true, iconUrl: uploaded.url, key: uploaded.key, assetId };
      }),

    assignToStudent: protectedProcedure
      .input(
        z.object({
          studentId: z.number(),
          badgeId: z.number(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        if (ctx.user.role !== "admin" && ctx.user.role !== "teacher") {
          throw new TRPCError({ code: "FORBIDDEN", message: "غير مصرح لك بمنح الشارات" });
        }

        if (ctx.user.role === "teacher") {
          const ownsAnyClass = await database
            .select({ id: classStudents.id })
            .from(classStudents)
            .innerJoin(classes, eq(classStudents.classId, classes.id))
            .where(and(eq(classStudents.studentId, input.studentId), eq(classes.teacherId, ctx.user.id)))
            .limit(1);

          if (!ownsAnyClass[0]) {
            throw new TRPCError({ code: "FORBIDDEN", message: "لا يمكنك منح شارة لطالب خارج فصولك" });
          }
        }

        const exists = await database
          .select({ id: studentBadges.id })
          .from(studentBadges)
          .where(and(eq(studentBadges.studentId, input.studentId), eq(studentBadges.badgeId, input.badgeId)))
          .limit(1);

        if (exists[0]) {
          return { success: true, alreadyAssigned: true };
        }

        await database.insert(studentBadges).values({
          studentId: input.studentId,
          badgeId: input.badgeId,
        });

        return { success: true, alreadyAssigned: false };
      }),

    revokeFromStudent: protectedProcedure
      .input(
        z.object({
          studentId: z.number(),
          badgeId: z.number(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        if (ctx.user.role !== "admin" && ctx.user.role !== "teacher") {
          throw new TRPCError({ code: "FORBIDDEN", message: "غير مصرح لك بسحب الشارات" });
        }

        if (ctx.user.role === "teacher") {
          const ownsAnyClass = await database
            .select({ id: classStudents.id })
            .from(classStudents)
            .innerJoin(classes, eq(classStudents.classId, classes.id))
            .where(and(eq(classStudents.studentId, input.studentId), eq(classes.teacherId, ctx.user.id)))
            .limit(1);

          if (!ownsAnyClass[0]) {
            throw new TRPCError({ code: "FORBIDDEN", message: "لا يمكنك سحب شارة لطالب خارج فصولك" });
          }
        }

        await database
          .delete(studentBadges)
          .where(and(eq(studentBadges.studentId, input.studentId), eq(studentBadges.badgeId, input.badgeId)));

        return { success: true };
      }),

    getStudentBadges: protectedProcedure
      .input(
        z.object({
          studentId: z.number(),
        })
      )
      .query(async ({ ctx, input }) => {
        const database = await getDb();
        if (!database) return [];

        if (ctx.user.role !== "admin" && ctx.user.role !== "teacher") {
          throw new TRPCError({ code: "FORBIDDEN", message: "غير مصرح لك بعرض شارات الطالب" });
        }

        if (ctx.user.role === "teacher") {
          const ownsAnyClass = await database
            .select({ id: classStudents.id })
            .from(classStudents)
            .innerJoin(classes, eq(classStudents.classId, classes.id))
            .where(and(eq(classStudents.studentId, input.studentId), eq(classes.teacherId, ctx.user.id)))
            .limit(1);

          if (!ownsAnyClass[0]) {
            throw new TRPCError({ code: "FORBIDDEN", message: "لا يمكنك عرض شارات طالب خارج فصولك" });
          }
        }

        return database
          .select({
            studentBadgeId: studentBadges.id,
            earnedAt: studentBadges.earnedAt,
            badge: badges,
          })
          .from(studentBadges)
          .innerJoin(badges, eq(studentBadges.badgeId, badges.id))
          .where(eq(studentBadges.studentId, input.studentId))
          .orderBy(desc(studentBadges.earnedAt));
      }),
  }),

  // الدروس التعليمية
  lessons: router({
    // الحصول على جميع الدروس
    getAll: publicProcedure.query(async () => {
      return db.getAllLessons();
    }),

    // الحصول على دروس حسب الفئة
    getByCategory: publicProcedure
      .input(z.object({ 
        category: z.enum(["drawing", "decoration", "colors", "texture"]) 
      }))
      .query(async ({ input }) => {
        return db.getLessonsByCategory(input.category);
      }),

    // إنشاء درس جديد (للمعلمين)
    create: protectedProcedure
      .input(z.object({
        title: z.string().min(1),
        description: z.string().optional(),
        content: z.string().optional(),
        contentTermVisibility: z.enum(["all", "first", "second"]).default("all"),
        grade: z.string().optional(),
        classId: z.number().optional(),
        isVisible: z.boolean().default(true),
        category: z.enum(["drawing", "decoration", "colors", "texture"]),
        videoUrl: z.string().optional(),
        videoStartTime: z.number().min(0).optional(),
        videoEndTime: z.number().min(0).optional(),
        videoMuted: z.boolean().default(false),
        imageUrl: z.string().optional(),
        externalQuizUrl: z.string().url().optional(),
        pdfUrl: z.string().url().optional(),
        order: z.number().default(0),
        parentLessonId: z.number().optional(),
        contentType: z.enum(["video", "image", "text", "mixed"]).default("text"),
        aiFeedback: z.object({
          mode: z.enum(["quick", "full"]),
          draft: z.object({
            description: z.string().optional(),
            content: z.string().optional(),
          }).optional(),
          finalSnapshot: z.object({
            description: z.string().optional(),
            content: z.string().optional(),
          }).optional(),
        }).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "teacher" && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN" });
        }

        await assertTeacherFeatureAccess({
          user: ctx.user,
          featureCode: SUBSCRIPTION_FEATURES.createLesson,
        });

        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const { aiFeedback, contentTermVisibility, ...lessonData } = input;
        const termVisibility = normalizeFixedTermVisibility(contentTermVisibility);
        const scopePayload = ctx.user.role === "admin"
          ? {
              contentScope: "global" as const,
              ownerTeacherId: null,
              createdByUserId: ctx.user.id,
            }
          : {
              contentScope: "teacher" as const,
              ownerTeacherId: ctx.user.id,
              createdByUserId: ctx.user.id,
            };
        const createResult: any = await db.createLessonNew({
          ...lessonData,
          termLabelRaw: fixedTermLabelFromVisibility(termVisibility),
          termId: null,
          ...scopePayload,
          teacherId: ctx.user.id,
        });

        const createdLessonId = Number(createResult?.insertId || createResult?.[0]?.insertId || 0);
        if (createdLessonId > 0) {
          await syncLessonAssetReferences(database, createdLessonId, {
            videoUrl: input.videoUrl || null,
            imageUrl: input.imageUrl || null,
            pdfUrl: input.pdfUrl || null,
          });

          await syncLinkedChallengeTermsFromLesson({
            database,
            lessonId: createdLessonId,
          });
        }

        if (aiFeedback) {
          const feedbackSummary = summarizeAiFeedback({
            draftDescription: aiFeedback?.draft?.description,
            draftContent: aiFeedback?.draft?.content,
            finalDescription: aiFeedback?.finalSnapshot?.description,
            finalContent: aiFeedback?.finalSnapshot?.content,
          });

          await logAdminAction(ctx, {
            action: "ai_lesson_feedback",
            details: { mode: aiFeedback.mode, phase: "create", ...feedbackSummary },
          });
        }

        return { success: true };
      }),

    // تعديل درس
    update: protectedProcedure
      .input(z.object({
        id: z.number(),
        title: z.string().optional(),
        description: z.string().optional(),
        content: z.string().optional(),
        contentTermVisibility: z.enum(["all", "first", "second"]).optional(),
        grade: z.string().optional(),
        classId: z.number().nullable().optional(),
        isVisible: z.boolean().optional(),
        category: z.enum(["drawing", "decoration", "colors", "texture"]).optional(),
        videoUrl: z.string().optional(),
        videoStartTime: z.number().min(0).optional(),
        videoEndTime: z.number().min(0).optional(),
        videoMuted: z.boolean().optional(),
        imageUrl: z.string().optional(),
        externalQuizUrl: z.string().url().nullable().optional(),
        pdfUrl: z.string().url().nullable().optional(),
        order: z.number().optional(),
        parentLessonId: z.number().optional(),
        contentType: z.enum(["video", "image", "text", "mixed"]).optional(),
        aiFeedback: z.object({
          mode: z.enum(["quick", "full"]),
          draft: z.object({
            description: z.string().optional(),
            content: z.string().optional(),
          }).optional(),
          finalSnapshot: z.object({
            description: z.string().optional(),
            content: z.string().optional(),
          }).optional(),
        }).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "teacher" && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN" });
        }

        await assertTeacherFeatureAccess({
          user: ctx.user,
          featureCode: SUBSCRIPTION_FEATURES.aiAssistant,
        });

        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const { id, aiFeedback, contentTermVisibility, ...data } = input;
        const normalizedData = {
          ...data,
          ...(contentTermVisibility
            ? {
                termLabelRaw: fixedTermLabelFromVisibility(normalizeFixedTermVisibility(contentTermVisibility)),
                termId: null,
              }
            : {}),
        };
        const currentRows = await database
          .select()
          .from(lessons)
          .where(eq(lessons.id, id))
          .limit(1);
        const current = currentRows[0];
        if (!current) {
          throw new TRPCError({ code: "NOT_FOUND", message: "الدرس غير موجود" });
        }

        const ownerId = Number(current.ownerTeacherId || current.teacherId || 0);
        const isGlobal = current.contentScope === "global" || (current.ownerTeacherId == null && current.classId == null);
        const isOwnedByTeacher = ownerId > 0 && ownerId === Number(ctx.user.id);

        let targetLessonId = id;

        if (ctx.user.role !== "admin" && isGlobal && !isOwnedByTeacher) {
          // Teacher edits of global lessons create/update teacher_override instead of mutating global source.
          const existingOverride = await database
            .select({ id: lessons.id })
            .from(lessons)
            .where(
              and(
                eq(lessons.sourceLessonId, id),
                eq(lessons.contentScope, "teacher_override"),
                eq(lessons.ownerTeacherId, ctx.user.id)
              )
            )
            .limit(1);

          if (existingOverride[0]?.id) {
            targetLessonId = Number(existingOverride[0].id);
            await db.updateLesson(targetLessonId, {
              ...normalizedData,
              ownerTeacherId: ctx.user.id,
              createdByUserId: ctx.user.id,
              contentScope: "teacher_override",
              sourceLessonId: id,
            });
          } else {
            const overridePayload = {
              title: Object.prototype.hasOwnProperty.call(normalizedData, "title") ? normalizedData.title || current.title : current.title,
              description: Object.prototype.hasOwnProperty.call(normalizedData, "description") ? normalizedData.description || current.description || "" : current.description || "",
              content: Object.prototype.hasOwnProperty.call(normalizedData, "content") ? normalizedData.content || current.content || "" : current.content || "",
              grade: Object.prototype.hasOwnProperty.call(normalizedData, "grade") ? normalizedData.grade || current.grade || "" : current.grade || "",
              classId: Object.prototype.hasOwnProperty.call(normalizedData, "classId") ? normalizedData.classId ?? null : current.classId,
              isVisible: Object.prototype.hasOwnProperty.call(normalizedData, "isVisible") ? normalizedData.isVisible ?? (current.isVisible ?? true) : (current.isVisible ?? true),
              category: Object.prototype.hasOwnProperty.call(normalizedData, "category") && normalizedData.category ? normalizedData.category : current.category,
              videoUrl: Object.prototype.hasOwnProperty.call(normalizedData, "videoUrl") ? normalizedData.videoUrl || "" : current.videoUrl || "",
              videoStartTime: Object.prototype.hasOwnProperty.call(normalizedData, "videoStartTime") ? normalizedData.videoStartTime ?? current.videoStartTime : current.videoStartTime,
              videoEndTime: Object.prototype.hasOwnProperty.call(normalizedData, "videoEndTime") ? normalizedData.videoEndTime ?? current.videoEndTime : current.videoEndTime,
              videoMuted: Object.prototype.hasOwnProperty.call(normalizedData, "videoMuted") ? normalizedData.videoMuted ?? (current.videoMuted ?? false) : (current.videoMuted ?? false),
              imageUrl: Object.prototype.hasOwnProperty.call(normalizedData, "imageUrl") ? normalizedData.imageUrl || "" : current.imageUrl || "",
              externalQuizUrl: Object.prototype.hasOwnProperty.call(normalizedData, "externalQuizUrl") ? normalizedData.externalQuizUrl ?? null : current.externalQuizUrl,
              pdfUrl: Object.prototype.hasOwnProperty.call(normalizedData, "pdfUrl") ? normalizedData.pdfUrl ?? null : current.pdfUrl,
              order: Object.prototype.hasOwnProperty.call(normalizedData, "order") ? normalizedData.order ?? (current.order ?? 0) : (current.order ?? 0),
              parentLessonId: Object.prototype.hasOwnProperty.call(normalizedData, "parentLessonId") ? normalizedData.parentLessonId ?? current.parentLessonId : current.parentLessonId,
              contentType: Object.prototype.hasOwnProperty.call(normalizedData, "contentType") && normalizedData.contentType ? normalizedData.contentType : (current.contentType || "text"),
              teacherId: ctx.user.id,
              ownerTeacherId: ctx.user.id,
              createdByUserId: ctx.user.id,
              sourceLessonId: id,
              contentScope: "teacher_override" as const,
              stageId: current.stageId,
              gradeId: current.gradeId,
              termId: contentTermVisibility ? null : current.termId,
              subjectId: current.subjectId,
              gradeLabelRaw: current.gradeLabelRaw,
              termLabelRaw: contentTermVisibility
                ? fixedTermLabelFromVisibility(normalizeFixedTermVisibility(contentTermVisibility))
                : current.termLabelRaw,
              subjectLabelRaw: current.subjectLabelRaw,
            };

            const insertRes = await db.createLessonNew(overridePayload);
            targetLessonId = Number((insertRes as any)?.[0]?.insertId || (insertRes as any)?.insertId || 0);
            if (!targetLessonId) {
              throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "تعذر إنشاء نسخة override للدرس" });
            }
          }
        } else {
          if (ctx.user.role !== "admin" && !isOwnedByTeacher) {
            throw new TRPCError({ code: "FORBIDDEN", message: "لا تملك صلاحية تعديل هذا الدرس" });
          }

          await db.updateLesson(id, normalizedData);
        }

        await syncLessonAssetReferences(database, targetLessonId, {
          videoUrl: Object.prototype.hasOwnProperty.call(input, "videoUrl") ? input.videoUrl ?? null : undefined,
          imageUrl: Object.prototype.hasOwnProperty.call(input, "imageUrl") ? input.imageUrl ?? null : undefined,
          pdfUrl: Object.prototype.hasOwnProperty.call(input, "pdfUrl") ? input.pdfUrl ?? null : undefined,
        });

        await syncLinkedChallengeTermsFromLesson({
          database,
          lessonId: targetLessonId,
        });

        if (aiFeedback) {
          const feedbackSummary = summarizeAiFeedback({
            draftDescription: aiFeedback?.draft?.description,
            draftContent: aiFeedback?.draft?.content,
            finalDescription: aiFeedback?.finalSnapshot?.description,
            finalContent: aiFeedback?.finalSnapshot?.content,
          });

          await logAdminAction(ctx, {
            action: "ai_lesson_feedback",
            details: { lessonId: targetLessonId, sourceLessonId: id, mode: aiFeedback.mode, phase: "update", ...feedbackSummary },
          });
        }

        return { success: true, lessonId: targetLessonId, isOverride: targetLessonId !== id };
      }),

    generateAIDraft: protectedProcedure
      .input(
        z.object({
          mode: z.enum(["quick", "full"]),
          title: z.string().min(1),
          grade: z.string().optional(),
          subject: z.string().optional(),
          category: z.enum(["drawing", "decoration", "colors", "texture"]).optional(),
          lessonContext: z.string().optional(),
          currentDescription: z.string().optional(),
          currentContent: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "teacher" && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN" });
        }

        await assertTeacherFeatureAccess({
          user: ctx.user,
          featureCode: SUBSCRIPTION_FEATURES.videoLibrary,
        });

        const draft = buildLessonAiDraft(input);
        return {
          success: true,
          draft,
          generatedAt: new Date().toISOString(),
        };
      }),

    generateTeachingGuideDraft: protectedProcedure
      .input(
        z.object({
          title: z.string().min(1),
          grade: z.string().optional(),
          subject: z.string().optional(),
          category: z.enum(["drawing", "decoration", "colors", "texture"]).optional(),
          lessonContext: z.string().optional(),
          currentDescription: z.string().optional(),
          currentContent: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "teacher" && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN" });
        }

        await assertTeacherFeatureAccess({
          user: ctx.user,
          featureCode: SUBSCRIPTION_FEATURES.uploadVideo,
        });

        const result = buildTeachingGuideDraft(input);
        return {
          success: true,
          draft: result.draft,
          generatedAt: new Date().toISOString(),
        };
      }),

    analyzeCurriculum: protectedProcedure
      .input(
        z.object({
          pathId: z.number().int().positive(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "teacher" && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN" });
        }

        await assertTeacherFeatureAccess({
          user: ctx.user,
          featureCode: SUBSCRIPTION_FEATURES.aiAssistant,
        });

        const database = await getDb();
        if (!database) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "قاعدة البيانات غير متاحة" });
        }

        const pathRows = await database
          .select()
          .from(learningPaths)
          .where(eq(learningPaths.id, input.pathId))
          .limit(1);

        const path = pathRows[0];
        if (!path) {
          throw new TRPCError({ code: "NOT_FOUND", message: "المسار غير موجود" });
        }

        if (ctx.user.role !== "admin" && Number(path.teacherId) !== Number(ctx.user.id)) {
          throw new TRPCError({ code: "FORBIDDEN", message: "لا تملك صلاحية تحليل هذا المسار" });
        }

        const pathLessonRows = await database
          .select({ id: pathLessons.id })
          .from(pathLessons)
          .where(eq(pathLessons.pathId, input.pathId))
          .limit(1);

        if (!pathLessonRows[0]) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "المسار لا يحتوي دروساً للتحليل" });
        }

        const context = await buildCurriculumContext({
          database,
          pathId: input.pathId,
          requesterRole: ctx.user.role,
          requesterId: ctx.user.id,
        });

        const insights = await generateCurriculumInsights(context);

        return {
          success: true,
          path: context.path,
          insights,
          analyzedAt: new Date().toISOString(),
        };
      }),

    detectCurriculumGaps: protectedProcedure
      .input(
        z.object({
          pathId: z.number().int().positive(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "teacher" && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN" });
        }

        await assertTeacherFeatureAccess({
          user: ctx.user,
          featureCode: SUBSCRIPTION_FEATURES.aiAssistant,
        });

        const database = await getDb();
        if (!database) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "قاعدة البيانات غير متاحة" });
        }

        const pathRows = await database
          .select()
          .from(learningPaths)
          .where(eq(learningPaths.id, input.pathId))
          .limit(1);

        const path = pathRows[0];
        if (!path) {
          throw new TRPCError({ code: "NOT_FOUND", message: "المسار غير موجود" });
        }

        if (ctx.user.role !== "admin" && Number(path.teacherId) !== Number(ctx.user.id)) {
          throw new TRPCError({ code: "FORBIDDEN", message: "لا تملك صلاحية تحليل هذا المسار" });
        }

        const pathLessonRows = await database
          .select({ id: pathLessons.id })
          .from(pathLessons)
          .where(eq(pathLessons.pathId, input.pathId))
          .limit(1);

        if (!pathLessonRows[0]) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "المسار لا يحتوي دروساً للتحليل" });
        }

        const context = await buildCurriculumContext({
          database,
          pathId: input.pathId,
          requesterRole: ctx.user.role,
          requesterId: ctx.user.id,
        });

        const gapInsights = await detectCurriculumGaps(context);

        return {
          success: true,
          path: context.path,
          gapInsights,
          analyzedAt: new Date().toISOString(),
        };
      }),

    suggestCurriculumActivities: protectedProcedure
      .input(
        z.object({
          pathId: z.number().int().positive(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "teacher" && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN" });
        }

        await assertTeacherFeatureAccess({
          user: ctx.user,
          featureCode: SUBSCRIPTION_FEATURES.aiAssistant,
        });

        const database = await getDb();
        if (!database) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "قاعدة البيانات غير متاحة" });
        }

        const pathRows = await database
          .select()
          .from(learningPaths)
          .where(eq(learningPaths.id, input.pathId))
          .limit(1);

        const path = pathRows[0];
        if (!path) {
          throw new TRPCError({ code: "NOT_FOUND", message: "المسار غير موجود" });
        }

        if (ctx.user.role !== "admin" && Number(path.teacherId) !== Number(ctx.user.id)) {
          throw new TRPCError({ code: "FORBIDDEN", message: "لا تملك صلاحية تحليل هذا المسار" });
        }

        const pathLessonRows = await database
          .select({ id: pathLessons.id })
          .from(pathLessons)
          .where(eq(pathLessons.pathId, input.pathId))
          .limit(1);

        if (!pathLessonRows[0]) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "المسار لا يحتوي دروساً للتحليل" });
        }

        const context = await buildCurriculumContext({
          database,
          pathId: input.pathId,
          requesterRole: ctx.user.role,
          requesterId: ctx.user.id,
        });

        const gapInsights = await detectCurriculumGaps(context);
        const activitySuggestions = await suggestCurriculumActivities({ context, gapInsights });

        return {
          success: true,
          path: context.path,
          gapInsights,
          activitySuggestions,
          analyzedAt: new Date().toISOString(),
        };
      }),

    generateCurriculumProject: protectedProcedure
      .input(
        z.object({
          pathId: z.number().int().positive(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "teacher" && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN" });
        }

        await assertTeacherFeatureAccess({
          user: ctx.user,
          featureCode: SUBSCRIPTION_FEATURES.aiAssistant,
        });

        const database = await getDb();
        if (!database) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "قاعدة البيانات غير متاحة" });
        }

        const pathRows = await database
          .select()
          .from(learningPaths)
          .where(eq(learningPaths.id, input.pathId))
          .limit(1);

        const path = pathRows[0];
        if (!path) {
          throw new TRPCError({ code: "NOT_FOUND", message: "المسار غير موجود" });
        }

        if (ctx.user.role !== "admin" && Number(path.teacherId) !== Number(ctx.user.id)) {
          throw new TRPCError({ code: "FORBIDDEN", message: "لا تملك صلاحية تحليل هذا المسار" });
        }

        const pathLessonRows = await database
          .select({ id: pathLessons.id })
          .from(pathLessons)
          .where(eq(pathLessons.pathId, input.pathId))
          .limit(1);

        if (!pathLessonRows[0]) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "المسار لا يحتوي دروساً للتحليل" });
        }

        const context = await buildCurriculumContext({
          database,
          pathId: input.pathId,
          requesterRole: ctx.user.role,
          requesterId: ctx.user.id,
        });

        const gapInsights = await detectCurriculumGaps(context);
        const activitySuggestions = await suggestCurriculumActivities({ context, gapInsights });
        const projectProposal = await generateCurriculumProject({
          context,
          gapInsights,
          activitySuggestions,
        });

        return {
          success: true,
          path: context.path,
          projectProposal,
          analyzedAt: new Date().toISOString(),
        };
      }),

    applyActivitySuggestion: protectedProcedure
      .input(
        z.object({
          pathId: z.number().int().positive(),
          suggestion: z.object({
            lessonId: z.number().int().positive(),
            suggestionType: z.enum(["activity", "enrichment", "remedial", "quiz"]),
            title: z.string().max(255).optional(),
            description: z.string().optional(),
            implementationHint: z.string().optional(),
            sourceIndex: z.number().int().nonnegative().optional(),
          }),
        })
      )
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "teacher" && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN" });
        }

        await assertTeacherFeatureAccess({
          user: ctx.user,
          featureCode: SUBSCRIPTION_FEATURES.aiAssistant,
        });

        const database = await getDb();
        if (!database) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "قاعدة البيانات غير متاحة" });
        }

        const pathRows = await database
          .select()
          .from(learningPaths)
          .where(eq(learningPaths.id, input.pathId))
          .limit(1);

        const path = pathRows[0];
        if (!path) {
          throw new TRPCError({ code: "NOT_FOUND", message: "المسار غير موجود" });
        }

        if (ctx.user.role !== "admin" && Number(path.teacherId) !== Number(ctx.user.id)) {
          throw new TRPCError({ code: "FORBIDDEN", message: "لا تملك صلاحية تنفيذ هذا الإجراء" });
        }

        const context = await buildCurriculumContext({
          database,
          pathId: input.pathId,
          requesterRole: ctx.user.role,
          requesterId: ctx.user.id,
        });

        const result = await applyActivitySuggestion({
          database,
          context,
          teacherId: ctx.user.role === "admin" ? Number(path.teacherId || ctx.user.id) : ctx.user.id,
          suggestion: input.suggestion,
        });

        return {
          ...result,
          path: context.path,
          appliedAt: new Date().toISOString(),
        };
      }),

    applyProjectProposal: protectedProcedure
      .input(
        z.object({
          lessonId: z.number().int().positive(),
          sourceIndex: z.number().int().nonnegative(),
          proposal: z.object({
            title: z.string().max(255).optional(),
            projectIdea: z.string().optional(),
            objectives: z.array(z.string().min(1)).optional(),
            relatedLessons: z.array(z.string().min(1)).optional(),
            requiredTools: z.array(z.string().min(1)).optional(),
            executionSteps: z.array(z.string().min(1)).optional(),
            expectedOutcome: z.string().optional(),
            rubric: z.array(z.string().min(1)).optional(),
            gradeTarget: z.string().optional(),
          }),
        })
      )
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "teacher" && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN" });
        }

        await assertTeacherFeatureAccess({
          user: ctx.user,
          featureCode: SUBSCRIPTION_FEATURES.aiAssistant,
        });

        const database = await getDb();
        if (!database) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "قاعدة البيانات غير متاحة" });
        }

        const lessonRows = await database
          .select()
          .from(lessons)
          .where(eq(lessons.id, input.lessonId))
          .limit(1);

        const lesson = lessonRows[0];
        if (!lesson) {
          throw new TRPCError({ code: "NOT_FOUND", message: "الدرس غير موجود" });
        }

        if (ctx.user.role !== "admin" && Number((lesson as any).teacherId) !== Number(ctx.user.id)) {
          throw new TRPCError({ code: "FORBIDDEN", message: "لا تملك صلاحية تنفيذ هذا الإجراء" });
        }

        const ownerTeacherId = Number((lesson as any).teacherId || ctx.user.id);

        const result = await applyProjectProposal({
          database,
          lessonId: input.lessonId,
          teacherId: ownerTeacherId,
          proposal: input.proposal,
          sourceIndex: input.sourceIndex,
        });

        return {
          success: result.success,
          deduped: result.deduped,
          createdEntityId: result.createdEntityId,
          createdEntityType: result.createdEntityType,
          message: result.message,
          appliedAt: new Date().toISOString(),
        };
      }),

    generateArtisticChallengeDrafts: protectedProcedure
      .input(
        z.object({
          pathId: z.number().int().positive(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "teacher" && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN" });
        }

        await assertTeacherFeatureAccess({
          user: ctx.user,
          featureCode: SUBSCRIPTION_FEATURES.createChallenge,
        });

        const database = await getDb();
        if (!database) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "قاعدة البيانات غير متاحة" });
        }

        const pathRows = await database
          .select()
          .from(learningPaths)
          .where(eq(learningPaths.id, input.pathId))
          .limit(1);

        const path = pathRows[0];
        if (!path) {
          throw new TRPCError({ code: "NOT_FOUND", message: "المسار غير موجود" });
        }

        if (ctx.user.role !== "admin" && Number(path.teacherId) !== Number(ctx.user.id)) {
          throw new TRPCError({ code: "FORBIDDEN", message: "لا تملك صلاحية تحليل هذا المسار" });
        }

        const context = await buildCurriculumContext({
          database,
          pathId: input.pathId,
          requesterRole: ctx.user.role,
          requesterId: ctx.user.id,
        });

        const drafts = await generateArtisticChallengeDrafts({ context });

        return {
          success: true,
          path: context.path,
          drafts,
          generatedAt: new Date().toISOString(),
        };
      }),

    createArtisticChallengeFromDraft: protectedProcedure
      .input(
        z.object({
          pathId: z.number().int().positive(),
          draft: z.object({
            lessonId: z.number().int().positive(),
            title: z.string().min(1).max(255),
            description: z.string().min(1),
            targetGrade: z.string().min(1),
            targetStage: z.enum(["primary", "middle", "secondary"]),
            suggestedTools: z.array(z.string().min(1)).min(1),
            executionSteps: z.array(z.string().min(1)).min(1),
            evaluationHint: z.string().min(1),
            difficulty: z.enum(["easy", "medium", "hard"]),
          }),
        })
      )
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "teacher" && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN" });
        }

        await assertTeacherFeatureAccess({
          user: ctx.user,
          featureCode: SUBSCRIPTION_FEATURES.createChallenge,
        });

        const database = await getDb();
        if (!database) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "قاعدة البيانات غير متاحة" });
        }

        const pathRows = await database
          .select()
          .from(learningPaths)
          .where(eq(learningPaths.id, input.pathId))
          .limit(1);

        const path = pathRows[0];
        if (!path) {
          throw new TRPCError({ code: "NOT_FOUND", message: "المسار غير موجود" });
        }

        if (ctx.user.role !== "admin" && Number(path.teacherId) !== Number(ctx.user.id)) {
          throw new TRPCError({ code: "FORBIDDEN", message: "لا تملك صلاحية تنفيذ هذا الإجراء" });
        }

        const created = await createArtisticChallengeFromDraft({
          database,
          teacherId: ctx.user.id,
          draft: input.draft,
        });

        return {
          success: true,
          ...created,
          deduped: created.deduped,
          existingEntityType: created.existingEntityType,
          existingEntityId: created.existingEntityId,
          message: created.deduped ? "العنصر موجود مسبقًا، تم تجاوز الإنشاء المكرر" : "تم إنشاء التحدي بنجاح",
          createdAt: new Date().toISOString(),
        };
      }),

    createAllArtisticChallenges: protectedProcedure
      .input(
        z.object({
          pathId: z.number().int().positive(),
          drafts: z.array(
            z.object({
              lessonId: z.number().int().positive(),
              title: z.string().min(1).max(255),
              description: z.string().min(1),
              targetGrade: z.string().min(1),
              targetStage: z.enum(["primary", "middle", "secondary"]),
              suggestedTools: z.array(z.string().min(1)).min(1),
              executionSteps: z.array(z.string().min(1)).min(1),
              evaluationHint: z.string().min(1),
              difficulty: z.enum(["easy", "medium", "hard"]),
            })
          ).min(1),
        })
      )
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "teacher" && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN" });
        }

        await assertTeacherFeatureAccess({
          user: ctx.user,
          featureCode: SUBSCRIPTION_FEATURES.createChallenge,
        });

        const database = await getDb();
        if (!database) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "قاعدة البيانات غير متاحة" });
        }

        const pathRows = await database
          .select()
          .from(learningPaths)
          .where(eq(learningPaths.id, input.pathId))
          .limit(1);

        const path = pathRows[0];
        if (!path) {
          throw new TRPCError({ code: "NOT_FOUND", message: "المسار غير موجود" });
        }

        if (ctx.user.role !== "admin" && Number(path.teacherId) !== Number(ctx.user.id)) {
          throw new TRPCError({ code: "FORBIDDEN", message: "لا تملك صلاحية تنفيذ هذا الإجراء" });
        }

        const created: Array<{ challengeId: number; title: string }> = [];
        const createdIds: number[] = [];
        const skippedTitles: string[] = [];
        for (const draft of input.drafts) {
          const one = await createArtisticChallengeFromDraft({
            database,
            teacherId: ctx.user.id,
            draft,
          });
          if (one.deduped) {
            skippedTitles.push(one.title);
          } else {
            created.push({ challengeId: one.challengeId, title: one.title });
            createdIds.push(one.challengeId);
          }
        }

        return {
          success: true,
          createdCount: created.length,
          skippedCount: skippedTitles.length,
          createdIds,
          skippedTitles,
          created,
          createdAt: new Date().toISOString(),
        };
      }),

    // حذف درس
    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "teacher" && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN" });
        }

        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const toDelete = await database
          .select({ id: lessons.id })
          .from(lessons)
          .where(or(eq(lessons.id, input.id), eq(lessons.parentLessonId, input.id)));

        for (const row of toDelete) {
          await detachEntityAssetReferences(database, {
            entityType: "lessons",
            entityId: Number(row.id),
          });
        }

        await db.deleteLesson(input.id);
        return { success: true };
      }),

    // الحصول على دروس المعلم
    getMyLessons: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role !== "teacher" && ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      const legacyLessonSelect = {
        id: lessons.id,
        title: lessons.title,
        description: lessons.description,
        content: lessons.content,
        contentScope: lessons.contentScope,
        ownerTeacherId: lessons.ownerTeacherId,
        createdByUserId: lessons.createdByUserId,
        sourceLessonId: lessons.sourceLessonId,
        grade: lessons.grade,
        termId: lessons.termId,
        termLabelRaw: lessons.termLabelRaw,
        classId: lessons.classId,
        isVisible: lessons.isVisible,
        category: lessons.category,
        videoUrl: lessons.videoUrl,
        videoStartTime: lessons.videoStartTime,
        videoEndTime: lessons.videoEndTime,
        videoMuted: lessons.videoMuted,
        imageUrl: lessons.imageUrl,
        externalQuizUrl: lessons.externalQuizUrl,
        pdfUrl: lessons.pdfUrl,
        order: lessons.order,
        parentLessonId: lessons.parentLessonId,
        contentType: lessons.contentType,
        teacherId: lessons.teacherId,
        createdAt: lessons.createdAt,
        updatedAt: lessons.updatedAt,
      };

      const database = await getDb();
      if (!database) return db.getLessonsByTeacher(ctx.user.id);

      if (ctx.user.role === "admin") {
        try {
          return await database
            .select(legacyLessonSelect)
            .from(lessons)
            .orderBy(lessons.order, lessons.createdAt);
        } catch (error) {
          if (!isLegacyScopeColumnError(error)) throw error;
          return await database
            .select(legacyLessonSelect)
            .from(lessons)
            .orderBy(lessons.order, lessons.createdAt);
        }
      }

      let ownedLessons: Array<(typeof legacyLessonSelect)> | any[] = [];
      try {
        ownedLessons = await database
          .select(legacyLessonSelect)
          .from(lessons)
          .where(
            and(
              or(
                and(
                  or(eq(lessons.contentScope, "teacher"), eq(lessons.contentScope, "teacher_override")),
                  or(eq(lessons.ownerTeacherId, ctx.user.id), eq(lessons.teacherId, ctx.user.id))
                ),
                eq(lessons.teacherId, ctx.user.id)
              ),
              or(eq(lessons.isVisible, true), isNull(lessons.isVisible))
            )
          )
          .orderBy(lessons.order, lessons.createdAt);
      } catch (error) {
        if (!isLegacyScopeColumnError(error)) throw error;
        return await database
          .select(legacyLessonSelect)
          .from(lessons)
          .where(and(eq(lessons.teacherId, ctx.user.id), or(eq(lessons.isVisible, true), isNull(lessons.isVisible))))
          .orderBy(lessons.order, lessons.createdAt);
      }

      const centralLessons = await database
        .select(legacyLessonSelect)
        .from(lessons)
        .where(
          and(
            eq(lessons.contentScope, "global"),
            or(eq(lessons.isVisible, true), isNull(lessons.isVisible))
          )
        )
        .orderBy(lessons.order, lessons.createdAt);

      const merged = new Map<number, (typeof ownedLessons)[number]>();
      for (const lesson of ownedLessons) {
        merged.set(Number(lesson.id), lesson);
      }
      for (const lesson of centralLessons) {
        merged.set(Number(lesson.id), lesson as (typeof ownedLessons)[number]);
      }

      const combined = Array.from(merged.values());
      const effective = resolveEffectiveLessonsForTeacher(combined, Number(ctx.user.id));
      const effectiveIds = new Set(effective.map((lesson) => Number((lesson as any).id)));

      return combined.filter((lesson) => effectiveIds.has(Number((lesson as any).id)));
    }),

    getPresentationById: protectedProcedure
      .input(z.object({ lessonId: z.number().int().positive() }))
      .query(async ({ ctx, input }) => {
        if (ctx.user.role !== "teacher" && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "غير مصرح لك بعرض الدرس" });
        }

        const database = await getDb();
        if (!database) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "قاعدة البيانات غير متاحة" });
        }

        const lessonRows = await database
          .select({
            id: lessons.id,
            title: lessons.title,
            description: lessons.description,
            content: lessons.content,
            grade: lessons.grade,
            classId: lessons.classId,
            termId: lessons.termId,
            termLabelRaw: lessons.termLabelRaw,
            category: lessons.category,
            contentType: lessons.contentType,
            videoUrl: lessons.videoUrl,
            videoStartTime: lessons.videoStartTime,
            videoEndTime: lessons.videoEndTime,
            videoMuted: lessons.videoMuted,
            imageUrl: lessons.imageUrl,
            externalQuizUrl: lessons.externalQuizUrl,
            pdfUrl: lessons.pdfUrl,
            isVisible: lessons.isVisible,
            contentScope: lessons.contentScope,
            ownerTeacherId: lessons.ownerTeacherId,
            teacherId: lessons.teacherId,
            gradeId: lessons.gradeId,
          })
          .from(lessons)
          .where(eq(lessons.id, input.lessonId))
          .limit(1);

        const lesson = lessonRows[0];
        if (!lesson) {
          throw new TRPCError({ code: "NOT_FOUND", message: "الدرس غير موجود" });
        }

        if (ctx.user.role !== "admin") {
          const hasAccess = await canUserAccessLessonForPlayback({
            database,
            user: { id: Number(ctx.user.id), role: String(ctx.user.role || "") },
            lesson: {
              id: Number(lesson.id),
              classId: lesson.classId == null ? null : Number(lesson.classId),
              isVisible: lesson.isVisible,
              contentScope: lesson.contentScope == null ? null : String(lesson.contentScope),
              ownerTeacherId: lesson.ownerTeacherId == null ? null : Number(lesson.ownerTeacherId),
              teacherId: lesson.teacherId == null ? null : Number(lesson.teacherId),
              grade: lesson.grade == null ? null : String(lesson.grade),
              gradeId: lesson.gradeId == null ? null : Number(lesson.gradeId),
              termId: lesson.termId == null ? null : Number(lesson.termId),
              termLabelRaw: lesson.termLabelRaw == null ? null : String(lesson.termLabelRaw),
            },
          });

          if (!hasAccess) {
            throw new TRPCError({ code: "FORBIDDEN", message: "لا يمكنك عرض هذا الدرس" });
          }
        }

        const classNameRows = lesson.classId == null
          ? []
          : await database
              .select({ name: classes.name })
              .from(classes)
              .where(eq(classes.id, Number(lesson.classId)))
              .limit(1);

        let challengeRows: Array<{
          id: number;
          title: string | null;
          description: string | null;
          difficulty: string | null;
          isVisible: boolean | null;
          teacherId: number | null;
        }> = [];

        try {
          challengeRows = await database
            .select({
              id: challenges.id,
              title: challenges.title,
              description: challenges.description,
              difficulty: challenges.difficulty,
              isVisible: challenges.isVisible,
              teacherId: challenges.teacherId,
            })
            .from(challenges)
            .where(eq(challenges.lessonId, input.lessonId))
            .orderBy(desc(challenges.id));
        } catch {
          challengeRows = [];
        }

        const visibleChallenges = challengeRows
          .filter((item) => item.isVisible !== false)
          .filter((item) => {
            if (ctx.user.role === "admin") return true;
            return Number(item.teacherId || 0) === Number(ctx.user.id);
          })
          .map((item) => ({
            id: Number(item.id),
            title: String(item.title || ""),
            description: String(item.description || ""),
            difficulty: item.difficulty == null ? null : String(item.difficulty),
          }));

        const quizRows = await database
          .select({
            id: quizzes.id,
            title: quizzes.title,
            description: quizzes.description,
            questions: quizzes.questions,
            updatedAt: quizzes.updatedAt,
            createdAt: quizzes.createdAt,
          })
          .from(quizzes)
          .where(eq(quizzes.lessonId, input.lessonId))
          .orderBy(desc(quizzes.updatedAt), desc(quizzes.createdAt));

        const visibleQuizzes = quizRows.filter((item) => !isQuizHidden(item.description));
        const bestQuiz = visibleQuizzes[0];
        const quizQuestions = bestQuiz ? parseAndNormalizeQuizQuestions(bestQuiz.questions) : [];

        const pathRows = await database
          .select({ title: learningPaths.title, teacherId: learningPaths.teacherId })
          .from(pathLessons)
          .innerJoin(learningPaths, eq(learningPaths.id, pathLessons.pathId))
          .where(eq(pathLessons.lessonId, input.lessonId));

        const lessonVideoAssetRows: Array<{
          id: number;
          uploadedAssetId: number;
          title: string | null;
          displayOrder: number | null;
          isPrimary: boolean | null;
          isPublished: boolean | null;
          visibleToStudents: boolean | null;
          objectKey: string | null;
          sourceType: string | null;
          mimeType: string | null;
          publicUrl: string | null;
          assetStatus: string | null;
        }> = await database
          .select({
            id: lessonVideoAssets.id,
            uploadedAssetId: lessonVideoAssets.uploadedAssetId,
            title: lessonVideoAssets.title,
            displayOrder: lessonVideoAssets.displayOrder,
            isPrimary: lessonVideoAssets.isPrimary,
            isPublished: lessonVideoAssets.isPublished,
            visibleToStudents: lessonVideoAssets.visibleToStudents,
            objectKey: uploadedAssets.objectKey,
            sourceType: uploadedAssets.sourceType,
            mimeType: uploadedAssets.mimeType,
            publicUrl: uploadedAssets.publicUrl,
            assetStatus: uploadedAssets.status,
          })
          .from(lessonVideoAssets)
          .innerJoin(uploadedAssets, eq(uploadedAssets.id, lessonVideoAssets.uploadedAssetId))
          .where(eq(lessonVideoAssets.lessonId, input.lessonId))
          .orderBy(asc(lessonVideoAssets.displayOrder), desc(lessonVideoAssets.id));

        const visibleForStudentsAssets = lessonVideoAssetRows
          .filter((row) => String(row.assetStatus || "") === "active")
          .filter((row) => String(row.mimeType || "").toLowerCase().startsWith("video/"))
          .filter(
          (row) => Boolean(row.isPublished) && Boolean(row.visibleToStudents)
          );

        const pickPreferredAsset = (items: any[]) => {
          if (items.length === 0) return null;
          const primary = items.find((row) => Boolean(row.isPrimary));
          return primary || items[0];
        };

        const chosenVideoAsset = pickPreferredAsset(visibleForStudentsAssets);

        const selectedVideoAsset = chosenVideoAsset
          ? {
              attachmentId: Number(chosenVideoAsset.id),
              uploadedAssetId: Number(chosenVideoAsset.uploadedAssetId),
              title: String(chosenVideoAsset.title || "").trim() || null,
              fileName:
                path.basename(String(chosenVideoAsset.objectKey || "")).trim() ||
                `video-${Number(chosenVideoAsset.uploadedAssetId || chosenVideoAsset.id)}`,
              mimeType: String(chosenVideoAsset.mimeType || "video/mp4"),
              publicUrl: String(chosenVideoAsset.publicUrl || ""),
              playbackUrl: `/api/lesson-videos/${Number(chosenVideoAsset.id)}/stream`,
              sourceType: String(chosenVideoAsset.sourceType || ""),
              isPrimary: Boolean(chosenVideoAsset.isPrimary),
              isPublished: Boolean(chosenVideoAsset.isPublished),
              visibleToStudents: Boolean(chosenVideoAsset.visibleToStudents),
            }
          : null;

        const visiblePathTitles = pathRows
          .filter((pathItem) => {
            if (ctx.user.role === "admin") return true;
            return Number(pathItem.teacherId || 0) === Number(ctx.user.id);
          })
          .map((pathItem) => String(pathItem.title || "").trim())
          .filter(Boolean);

        return {
          lesson: {
            id: Number(lesson.id),
            title: String(lesson.title || ""),
            description: lesson.description == null ? null : String(lesson.description),
            content: lesson.content == null ? null : String(lesson.content),
            grade: lesson.grade == null ? null : String(lesson.grade),
            classId: lesson.classId == null ? null : Number(lesson.classId),
            className: classNameRows[0]?.name ? String(classNameRows[0].name) : null,
            termLabelRaw: lesson.termLabelRaw == null ? null : String(lesson.termLabelRaw),
            category: String(lesson.category || "text"),
            contentType: String(lesson.contentType || "text"),
            videoUrl: lesson.videoUrl == null ? null : String(lesson.videoUrl),
            videoStartTime: lesson.videoStartTime == null ? null : Number(lesson.videoStartTime),
            videoEndTime: lesson.videoEndTime == null ? null : Number(lesson.videoEndTime),
            videoMuted: Boolean(lesson.videoMuted),
            imageUrl: lesson.imageUrl == null ? null : String(lesson.imageUrl),
            externalQuizUrl: lesson.externalQuizUrl == null ? null : String(lesson.externalQuizUrl),
            pdfUrl: lesson.pdfUrl == null ? null : String(lesson.pdfUrl),
            isVisible: lesson.isVisible !== false,
            videoAsset: selectedVideoAsset,
          },
          pathTitles: Array.from(new Set(visiblePathTitles)),
          challenges: visibleChallenges,
          quizSummary: {
            hasQuiz: Boolean(bestQuiz),
            quizId: bestQuiz ? Number(bestQuiz.id) : null,
            title: bestQuiz ? String(bestQuiz.title || "") : null,
            questionsCount: quizQuestions.length,
          },
        };
      }),

    getForStudent: protectedProcedure.query(async ({ ctx }) => {
      const database = await getDb();
      if (!database) return [];

      const studentClassRows = await database
        .select({
          classId: classStudents.classId,
          grade: classes.grade,
          teacherId: classes.teacherId,
          studentContentTermVisibility: classes.studentContentTermVisibility,
        })
        .from(classStudents)
        .innerJoin(classes, eq(classStudents.classId, classes.id))
        .where(eq(classStudents.studentId, ctx.user.id));

      if (studentClassRows.length === 0) return [];

      const classIds = Array.from(new Set(studentClassRows.map((row) => row.classId)));
      const classPolicyById = new Map<number, FixedTermVisibility>();
      for (const row of studentClassRows) {
        classPolicyById.set(Number(row.classId), normalizeFixedTermVisibility(row.studentContentTermVisibility));
      }
      const classPolicies = Array.from(classPolicyById.values());
      const teacherIds = Array.from(new Set(studentClassRows.map((row) => row.teacherId)));
      const normalizedStudentGrades = new Set(
        studentClassRows
          .map((row) => normalizeGradeKey(String(row.grade || "")))
          .filter(Boolean)
      );
      const canonicalStudentGradeIds = await resolveCanonicalGradeIds(
        database,
        studentClassRows.map((row) => row.grade),
      );

      const visibilityConditions: SQL<unknown>[] = [
        inArray(lessons.classId, classIds),
        isNull(lessons.classId),
      ].filter(isDefinedSql);

      const result = await database
        .select()
        .from(lessons)
        .where(
          and(
            or(eq(lessons.isVisible, true), isNull(lessons.isVisible)),
            or(...visibilityConditions)
          )
        )
        .orderBy(lessons.order, lessons.createdAt);

      const filteredLessons = result.filter((lessonItem) => {
        const contentTerm = extractFixedTermFromContent({
          termId: lessonItem.termId,
          termLabelRaw: lessonItem.termLabelRaw,
        });
        if (lessonItem.classId != null) {
          if (!classIds.includes(Number(lessonItem.classId))) return false;
          const classPolicy = classPolicyById.get(Number(lessonItem.classId));
          if (!classPolicy) return false;
          return isContentTermAllowedByClassPolicy({ classPolicy, contentTerm });
        }

        if (!isContentTermAllowedByStudentClasses({ classPolicies, contentTerm })) {
          return false;
        }

        const gradeMatches = matchesGradeCanonicalFirst({
          itemGradeId: lessonItem.gradeId,
          itemGradeRaw: lessonItem.grade,
          canonicalGradeIds: canonicalStudentGradeIds,
          normalizedLegacyGrades: normalizedStudentGrades,
        });
        const isGlobal = lessonItem.contentScope === "global" || (lessonItem.ownerTeacherId == null && lessonItem.classId == null);
        if (isGlobal) {
          return gradeMatches;
        }

        const ownerId = Number(lessonItem.ownerTeacherId || lessonItem.teacherId || 0);
        const belongsToMyTeacher = ownerId > 0 && teacherIds.includes(ownerId);
        return belongsToMyTeacher && gradeMatches;
      });

      if (filteredLessons.length === 0) {
        return [];
      }

      const lessonIds = Array.from(new Set(filteredLessons.map((item) => Number(item.id)).filter((id) => id > 0)));
      if (lessonIds.length === 0) {
        return filteredLessons.map((lessonItem) => ({
          ...lessonItem,
          hasPublishedQuiz: false,
          linkedQuizId: null,
        }));
      }

      const quizRows = await database
        .select({
          id: quizzes.id,
          lessonId: quizzes.lessonId,
          description: quizzes.description,
          questions: quizzes.questions,
          createdAt: quizzes.createdAt,
          updatedAt: quizzes.updatedAt,
        })
        .from(quizzes)
        .where(inArray(quizzes.lessonId, lessonIds));

      const bestQuizByLesson = new Map<number, { id: number; score: number }>();
      for (const row of quizRows) {
        const lessonId = Number(row.lessonId || 0);
        if (!lessonId) continue;
        if (isQuizHidden(row.description)) continue;

        const normalizedQuestions = parseAndNormalizeQuizQuestions(row.questions);
        if (normalizedQuestions.length < 3) continue;

        const score = scoreQuizQuestions(normalizedQuestions);
        const current = bestQuizByLesson.get(lessonId);
        if (!current || score > current.score || (score === current.score && Number(row.id) > current.id)) {
          bestQuizByLesson.set(lessonId, { id: Number(row.id), score });
        }
      }

      return filteredLessons.map((lessonItem) => {
        const linked = bestQuizByLesson.get(Number(lessonItem.id));
        return {
          ...lessonItem,
          hasPublishedQuiz: Boolean(linked),
          linkedQuizId: linked ? linked.id : null,
        };
      });
    }),

    getLessonVideosForPlayback: protectedProcedure
      .input(z.object({ lessonId: z.number().int().positive() }))
      .query(async ({ ctx, input }) => {
        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const lessonRows = await database
          .select({
            id: lessons.id,
            classId: lessons.classId,
            isVisible: lessons.isVisible,
            contentScope: lessons.contentScope,
            ownerTeacherId: lessons.ownerTeacherId,
            teacherId: lessons.teacherId,
            grade: lessons.grade,
            gradeId: lessons.gradeId,
            termId: lessons.termId,
            termLabelRaw: lessons.termLabelRaw,
          })
          .from(lessons)
          .where(eq(lessons.id, input.lessonId))
          .limit(1);

        const lesson = lessonRows[0];
        if (!lesson) {
          throw new TRPCError({ code: "NOT_FOUND", message: "الدرس غير موجود" });
        }

        const hasAccess = await canUserAccessLessonForPlayback({
          database,
          user: { id: Number(ctx.user.id), role: String(ctx.user.role || "") },
          lesson: {
            id: Number(lesson.id),
            classId: lesson.classId == null ? null : Number(lesson.classId),
            isVisible: lesson.isVisible,
            contentScope: lesson.contentScope == null ? null : String(lesson.contentScope),
            ownerTeacherId: lesson.ownerTeacherId == null ? null : Number(lesson.ownerTeacherId),
            teacherId: lesson.teacherId == null ? null : Number(lesson.teacherId),
            grade: lesson.grade == null ? null : String(lesson.grade),
            gradeId: lesson.gradeId == null ? null : Number(lesson.gradeId),
            termId: lesson.termId == null ? null : Number(lesson.termId),
            termLabelRaw: lesson.termLabelRaw == null ? null : String(lesson.termLabelRaw),
          },
        });

        if (!hasAccess) {
          throw new TRPCError({ code: "FORBIDDEN", message: "لا تملك صلاحية الوصول لهذا الدرس" });
        }

        const rows = await database
          .select({
            attachmentId: lessonVideoAssets.id,
            uploadedAssetId: lessonVideoAssets.uploadedAssetId,
            title: lessonVideoAssets.title,
            displayOrder: lessonVideoAssets.displayOrder,
            startSeconds: lessonVideoAssets.startSeconds,
            endSeconds: lessonVideoAssets.endSeconds,
            isPrimary: lessonVideoAssets.isPrimary,
            isPublished: lessonVideoAssets.isPublished,
            visibleToStudents: lessonVideoAssets.visibleToStudents,
            mimeType: uploadedAssets.mimeType,
            fileSize: uploadedAssets.fileSize,
            sourceType: uploadedAssets.sourceType,
            objectKey: uploadedAssets.objectKey,
            assetStatus: uploadedAssets.status,
          })
          .from(lessonVideoAssets)
          .innerJoin(uploadedAssets, eq(uploadedAssets.id, lessonVideoAssets.uploadedAssetId))
          .where(eq(lessonVideoAssets.lessonId, input.lessonId))
          .orderBy(asc(lessonVideoAssets.displayOrder), desc(lessonVideoAssets.id));

        return rows
          .filter((row) => String(row.assetStatus || "") === "active")
          .filter((row) => String(row.sourceType || "") === "metube_video_import")
          .filter((row) => String(row.mimeType || "").toLowerCase().startsWith("video/"))
          .filter((row) => Boolean(row.isPublished) && Boolean(row.visibleToStudents))
          .map((row) => {
            const fileName = path.basename(String(row.objectKey || "")).trim() || `video-${row.uploadedAssetId}`;
            const cleanTitle = String(row.title || "").trim() || fileName;
            return {
              attachmentId: Number(row.attachmentId),
              uploadedAssetId: Number(row.uploadedAssetId),
              title: cleanTitle,
              fileName,
              mimeType: String(row.mimeType || "video/mp4"),
              fileSize: row.fileSize == null ? null : Number(row.fileSize),
              displayOrder: Number(row.displayOrder || 0),
              startSeconds: row.startSeconds == null ? null : Number(row.startSeconds),
              endSeconds: row.endSeconds == null ? null : Number(row.endSeconds),
              isPrimary: Boolean(row.isPrimary),
              playbackUrl: `/api/lesson-videos/${Number(row.attachmentId)}/stream`,
            };
          });
      }),

    getVideoAttachmentsForEditor: protectedProcedure
      .input(z.object({ lessonId: z.number().int().positive() }))
      .query(async ({ ctx, input }) => {
        if (ctx.user.role !== "teacher" && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN" });
        }

        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const lessonRows = await database
          .select({
            id: lessons.id,
            teacherId: lessons.teacherId,
            ownerTeacherId: lessons.ownerTeacherId,
            contentScope: lessons.contentScope,
          })
          .from(lessons)
          .where(eq(lessons.id, input.lessonId))
          .limit(1);

        const lesson = lessonRows[0];
        if (!lesson) {
          throw new TRPCError({ code: "NOT_FOUND", message: "الدرس غير موجود" });
        }

        if (ctx.user.role !== "admin") {
          const ownerId = Number(lesson.ownerTeacherId || lesson.teacherId || 0);
          if (ownerId !== Number(ctx.user.id)) {
            throw new TRPCError({ code: "FORBIDDEN", message: "لا تملك صلاحية إدارة فيديوهات هذا الدرس" });
          }
        }

        const attachments = await listLessonVideoAttachments(database, input.lessonId);
        return attachments
          .filter((row: any) => String(row.assetStatus || "") === "active")
          .filter((row: any) => String(row.mimeType || "").toLowerCase().startsWith("video/"));
      }),

    updateVideoAttachmentSettings: protectedProcedure
      .input(
        z.object({
          attachmentId: z.number().int().positive(),
          title: z.string().trim().max(255).optional(),
          displayOrder: z.number().int().min(0).optional(),
          startSeconds: z.number().int().min(0).nullable().optional(),
          endSeconds: z.number().int().min(0).nullable().optional(),
          isPublished: z.boolean().optional(),
          visibleToStudents: z.boolean().optional(),
          isPrimary: z.boolean().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "teacher" && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN" });
        }

        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const rows = await database
          .select({
            id: lessonVideoAssets.id,
            lessonId: lessonVideoAssets.lessonId,
            isPublished: lessonVideoAssets.isPublished,
            teacherId: lessons.teacherId,
            ownerTeacherId: lessons.ownerTeacherId,
          })
          .from(lessonVideoAssets)
          .innerJoin(lessons, eq(lessons.id, lessonVideoAssets.lessonId))
          .where(eq(lessonVideoAssets.id, input.attachmentId))
          .limit(1);

        const current = rows[0];
        if (!current) {
          throw new TRPCError({ code: "NOT_FOUND", message: "لم يتم العثور على ربط الفيديو" });
        }

        if (ctx.user.role !== "admin") {
          const ownerId = Number(current.ownerTeacherId || current.teacherId || 0);
          if (ownerId !== Number(ctx.user.id)) {
            throw new TRPCError({ code: "FORBIDDEN", message: "لا تملك صلاحية تعديل هذا الربط" });
          }
        }

        const startSeconds = input.startSeconds == null ? null : Number(input.startSeconds);
        const endSeconds = input.endSeconds == null ? null : Number(input.endSeconds);
        if (startSeconds != null && endSeconds != null && endSeconds <= startSeconds) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "وقت النهاية يجب أن يكون أكبر من وقت البداية" });
        }

        const updateData: Record<string, unknown> = {};
        if (typeof input.title === "string") updateData.title = input.title.trim() || null;
        if (typeof input.displayOrder === "number") updateData.displayOrder = input.displayOrder;
        if (Object.prototype.hasOwnProperty.call(input, "startSeconds")) updateData.startSeconds = startSeconds;
        if (Object.prototype.hasOwnProperty.call(input, "endSeconds")) updateData.endSeconds = endSeconds;

        if (typeof input.isPublished === "boolean") {
          updateData.isPublished = input.isPublished;
          if (input.isPublished) {
            updateData.publishedAt = new Date();
            updateData.publishedByUserId = Number(ctx.user.id);
          } else {
            updateData.visibleToStudents = false;
            updateData.publishedAt = null;
            updateData.publishedByUserId = null;
          }
        }

        if (typeof input.visibleToStudents === "boolean") {
          const effectivePublished = typeof input.isPublished === "boolean" ? input.isPublished : Boolean(current.isPublished);
          if (input.visibleToStudents && !effectivePublished) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "لا يمكن إظهار الفيديو قبل نشره" });
          }
          updateData.visibleToStudents = input.visibleToStudents;
        }

        if (Object.keys(updateData).length > 0) {
          await database
            .update(lessonVideoAssets)
            .set(updateData)
            .where(eq(lessonVideoAssets.id, input.attachmentId));
        }

        if (input.isPrimary === true) {
          await ensurePrimaryForLesson(database, Number(current.lessonId), Number(current.id));
        }

        return {
          success: true,
          attachmentId: Number(current.id),
          lessonId: Number(current.lessonId),
        };
      }),

    unlinkVideoAttachment: protectedProcedure
      .input(z.object({ attachmentId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "teacher" && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN" });
        }

        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const rows = await database
          .select({
            id: lessonVideoAssets.id,
            lessonId: lessonVideoAssets.lessonId,
            isPrimary: lessonVideoAssets.isPrimary,
            uploadedAssetId: lessonVideoAssets.uploadedAssetId,
            teacherId: lessons.teacherId,
            ownerTeacherId: lessons.ownerTeacherId,
          })
          .from(lessonVideoAssets)
          .innerJoin(lessons, eq(lessons.id, lessonVideoAssets.lessonId))
          .where(eq(lessonVideoAssets.id, input.attachmentId))
          .limit(1);

        const attachment = rows[0];
        if (!attachment) {
          throw new TRPCError({ code: "NOT_FOUND", message: "الربط غير موجود" });
        }

        if (ctx.user.role !== "admin") {
          const ownerId = Number(attachment.ownerTeacherId || attachment.teacherId || 0);
          if (ownerId !== Number(ctx.user.id)) {
            throw new TRPCError({ code: "FORBIDDEN", message: "لا تملك صلاحية فك هذا الربط" });
          }
        }

        await database.delete(lessonVideoAssets).where(eq(lessonVideoAssets.id, Number(attachment.id)));

        if (attachment.isPrimary) {
          const nextRows = await database
            .select({ id: lessonVideoAssets.id })
            .from(lessonVideoAssets)
            .where(eq(lessonVideoAssets.lessonId, Number(attachment.lessonId)))
            .orderBy(asc(lessonVideoAssets.displayOrder), desc(lessonVideoAssets.id))
            .limit(1);

          if (nextRows[0]?.id) {
            await ensurePrimaryForLesson(database, Number(attachment.lessonId), Number(nextRows[0].id));
          }
        }

        return {
          success: true,
          attachmentId: Number(attachment.id),
          lessonId: Number(attachment.lessonId),
          uploadedAssetId: Number(attachment.uploadedAssetId),
          note: "تم فك الربط فقط. لم يتم حذف أصل الفيديو من التخزين.",
        };
      }),

    // الحصول على الدروس الفرعية
    getSubLessons: publicProcedure
      .input(z.object({ parentLessonId: z.number() }))
      .query(async ({ input }) => {
        return db.getSubLessons(input.parentLessonId);
      }),

    // رفع ملف PDF للدرس (للمعلم/الأدمن)
    uploadPdf: protectedProcedure
      .input(
        z.object({
          pdfData: z.string().min(1),
          fileName: z.string().min(1).optional(),
          mimeType: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "teacher" && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN" });
        }

        const mimeType = input.mimeType || "application/pdf";
        if (mimeType !== "application/pdf") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "يُسمح فقط بملفات PDF" });
        }

        const cleanedBase64 = input.pdfData.replace(/^data:application\/pdf;base64,/, "");
        const buffer = Buffer.from(cleanedBase64, "base64");
        if (!buffer.length) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "ملف PDF غير صالح" });
        }

        if (buffer.length > 25 * 1024 * 1024) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "حجم ملف PDF يجب ألا يتجاوز 25MB" });
        }

        const safeName = (input.fileName || `lesson-pdf-${Date.now()}`)
          .replace(/\.[^/.]+$/, "")
          .replace(/[^a-zA-Z0-9-_]/g, "-")
          .slice(0, 80);

        const uploaded = await storagePut(
          `lessons/pdfs/${ctx.user.id}-${Date.now()}-${safeName}.pdf`,
          buffer,
          "application/pdf"
        );

        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const assetId = await registerInternalAsset(database, {
          provider: "spaces",
          bucket: uploaded.bucket,
          objectKey: uploaded.key,
          publicUrl: uploaded.url,
          mimeType: "application/pdf",
          fileSize: buffer.length,
          sourceType: "lesson_pdf_upload",
          ownershipContext: `teacher:${ctx.user.id}`,
        });

        return {
          success: true,
          url: uploaded.url,
          key: uploaded.key,
          bucket: uploaded.bucket,
          assetId,
        };
      }),

    // تحليل رابط فيديو خارجي لتحديد إمكانية التحميل القانونية
    analyzeExternalVideo: protectedProcedure
      .input(
        z.object({
          url: z.string().url(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "teacher" && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN" });
        }

        const parsed = new URL(input.url);
        const provider = detectVideoProvider(parsed);

        if (provider === "youtube" || provider === "tiktok") {
          return {
            provider,
            canEmbed: true,
            canDownload: true,
            reason: "تنبيه قانوني: تأكد من امتلاك حقوق الاستخدام/التحميل قبل تنزيل أي محتوى من المنصات الخارجية.",
            normalizedUrl: input.url,
          };
        }

        if (provider === "direct") {
          return {
            provider,
            canEmbed: true,
            canDownload: true,
            reason: "رابط ملف مباشر قابل للتنزيل (حسب صلاحيات المصدر) مع الالتزام بحقوق النشر.",
            normalizedUrl: input.url,
          };
        }

        let contentType = "";
        let contentLength = "";
        try {
          const response = await fetch(input.url, { method: "HEAD" });
          contentType = response.headers.get("content-type") || "";
          contentLength = response.headers.get("content-length") || "";
        } catch {
          // Continue with conservative result below.
        }

        const isLikelyVideo = /^video\//i.test(contentType);

        return {
          provider,
          canEmbed: true,
          canDownload: true,
          reason: isLikelyVideo
            ? "يمكن محاولة التنزيل من هذا المصدر. يرجى الالتزام بحقوق النشر." 
            : "يمكن محاولة التنزيل، وقد يفشل حسب قيود المصدر. المسؤولية القانونية على المستخدم.",
          normalizedUrl: input.url,
          contentType,
          contentLength,
        };
      }),

    // تنزيل فيديو خارجي عبر الخادم (إن كان الرابط ملف فيديو مباشرًا)
    downloadExternalVideo: protectedProcedure
      .input(
        z.object({
          url: z.string().url(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "teacher" && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN" });
        }

        const MAX_BYTES = 300 * 1024 * 1024; // 300MB
        const parsed = new URL(input.url);
        const pathLooksLikeVideo = /\.(mp4|webm|ogg|mov|m4v|mkv)(\?|#|$)/i.test(parsed.pathname);

        const response = await fetch(input.url, { method: "GET" });
        if (!response.ok) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "تعذر الوصول إلى رابط الفيديو" });
        }

        const contentType = response.headers.get("content-type") || "";
        const contentLength = Number(response.headers.get("content-length") || "0");
        const looksLikeVideo = /^video\//i.test(contentType) || pathLooksLikeVideo;

        if (!looksLikeVideo) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "الرابط ليس ملف فيديو مباشرًا قابلًا للتنزيل عبر الخادم",
          });
        }

        if (contentLength > MAX_BYTES) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "حجم الفيديو يتجاوز الحد المسموح (300MB)" });
        }

        const bytes = new Uint8Array(await response.arrayBuffer());
        if (!bytes.length) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "تم تنزيل ملف فارغ" });
        }
        if (bytes.length > MAX_BYTES) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "حجم الفيديو بعد التنزيل يتجاوز 300MB" });
        }

        const rawName = extractFileNameFromUrl(input.url, `video-${Date.now()}`);
        const safeName = rawName
          .replace(/\?.*$/, "")
          .replace(/\.[^/.]+$/, "")
          .replace(/[^a-zA-Z0-9-_]/g, "-")
          .slice(0, 80) || `video-${Date.now()}`;

        const extensionFromPath = (parsed.pathname.match(/\.([a-zA-Z0-9]+)$/)?.[1] || "").toLowerCase();
        const extensionFromType = (contentType.split("/")[1] || "mp4").toLowerCase();
        const extension = extensionFromPath || extensionFromType || "mp4";
        const finalName = `${safeName}.${extension}`;

        const uploaded = await storagePut(
          `downloads/videos/${ctx.user.id}-${Date.now()}-${finalName}`,
          Buffer.from(bytes),
          contentType || "video/mp4"
        );

        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const assetId = await registerInternalAsset(database, {
          provider: "spaces",
          bucket: uploaded.bucket,
          objectKey: uploaded.key,
          publicUrl: uploaded.url,
          mimeType: contentType || "video/mp4",
          fileSize: bytes.length,
          sourceType: "lesson_video_download",
          ownershipContext: `teacher:${ctx.user.id}`,
        });

        return {
          success: true,
          fileName: finalName,
          downloadUrl: uploaded.url,
          assetId,
          sourceUrl: input.url,
          note: "تمت تهيئة نسخة قابلة للتنزيل. المسؤولية القانونية تقع على المستخدم.",
        };
      }),

    // رفع ملف فيديو محلي (للمعلم/الأدمن)
    uploadVideo: protectedProcedure
      .input(
        z.object({
          videoData: z.string().min(1),
          fileName: z.string().min(1).optional(),
          mimeType: z.string().min(1).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "teacher" && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN" });
        }

        const mimeType = input.mimeType || "video/mp4";
        if (!mimeType.startsWith("video/")) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "يُسمح فقط بملفات الفيديو" });
        }

        const cleanedBase64 = input.videoData.replace(/^data:video\/[a-zA-Z0-9+.-]+;base64,/, "");
        const buffer = Buffer.from(cleanedBase64, "base64");
        if (!buffer.length) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "ملف الفيديو غير صالح" });
        }

        if (buffer.length > 250 * 1024 * 1024) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "حجم ملف الفيديو يجب ألا يتجاوز 250MB" });
        }

        const extension = mimeType.split("/")[1] || "mp4";
        const safeName = (input.fileName || `lesson-video-${Date.now()}`)
          .replace(/\.[^/.]+$/, "")
          .replace(/[^a-zA-Z0-9-_]/g, "-")
          .slice(0, 80);

        const uploaded = await storagePut(
          `lessons/videos/${ctx.user.id}-${Date.now()}-${safeName}.${extension}`,
          buffer,
          mimeType
        );

        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const assetId = await registerInternalAsset(database, {
          provider: "spaces",
          bucket: uploaded.bucket,
          objectKey: uploaded.key,
          publicUrl: uploaded.url,
          mimeType,
          fileSize: buffer.length,
          sourceType: "lesson_video_upload",
          ownershipContext: `teacher:${ctx.user.id}`,
        });

        return {
          success: true,
          url: uploaded.url,
          key: uploaded.key,
          bucket: uploaded.bucket,
          assetId,
        };
      }),
  }),

  // التحديات الفنية
  challenges: router({
    // الحصول على التحديات النشطة
    getActive: publicProcedure.query(async () => {
      return db.getActiveChallenges();
    }),

    // الحصول على تحديات المعلم
    getMy: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role !== "teacher" && ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      const database = await getDb();
      if (!database) return [];

      if (ctx.user.role === "admin") {
        return database.select().from(challenges)
          .orderBy(desc(challenges.createdAt));
      }

      return database.select().from(challenges)
        .where(eq(challenges.teacherId, ctx.user.id))
        .orderBy(desc(challenges.createdAt));
    }),

    // إنشاء تحدي جديد (للمعلمين)
    create: protectedProcedure
      .input(z.object({
        title: z.string().min(1),
        description: z.string(),
        lessonId: z.number().int().positive().optional(),
        contentTermVisibility: z.enum(["all", "first", "second"]).default("all"),
        classId: z.number().optional(),
        grade: z.string().optional(),
        isVisible: z.boolean().default(true),
        startDate: z.date(),
        endDate: z.date(),
        difficulty: z.enum(["easy", "medium", "hard"]),
        points: z.number().default(10),
        targetGender: z.enum(["all", "boys", "girls"]).default("all"),
        imageUrl: z.string().optional(),
        badgeIconUrl: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "teacher" && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN" });
        }

        await assertTeacherFeatureAccess({
          user: ctx.user,
          featureCode: SUBSCRIPTION_FEATURES.createChallenge,
        });

        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        let inheritedTermId: number | null = null;
        let inheritedTermLabelRaw: string | null = null;
        if (input.lessonId) {
          const lessonRows = await database
            .select({
              id: lessons.id,
              termId: lessons.termId,
              termLabelRaw: lessons.termLabelRaw,
              teacherId: lessons.teacherId,
              ownerTeacherId: lessons.ownerTeacherId,
            })
            .from(lessons)
            .where(eq(lessons.id, input.lessonId))
            .limit(1);
          const linkedLesson = lessonRows[0];
          if (!linkedLesson) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "الدرس المرتبط غير موجود" });
          }

          if (ctx.user.role !== "admin") {
            const ownerId = Number(linkedLesson.ownerTeacherId || linkedLesson.teacherId || 0);
            if (ownerId !== Number(ctx.user.id)) {
              throw new TRPCError({ code: "FORBIDDEN", message: "لا تملك صلاحية ربط هذا الدرس" });
            }
          }

          inheritedTermId = linkedLesson.termId == null ? null : Number(linkedLesson.termId);
          inheritedTermLabelRaw = linkedLesson.termLabelRaw == null ? null : String(linkedLesson.termLabelRaw);
        }

        const explicitTermLabelRaw = fixedTermLabelFromVisibility(normalizeFixedTermVisibility(input.contentTermVisibility));
        const effectiveTermId = input.lessonId ? inheritedTermId : null;
        const effectiveTermLabelRaw = input.lessonId ? inheritedTermLabelRaw : explicitTermLabelRaw;

        const { contentTermVisibility, ...challengePayload } = input;

        await db.createChallengeNew({
          ...challengePayload,
          lessonId: input.lessonId ?? undefined,
          termId: effectiveTermId,
          termLabelRaw: effectiveTermLabelRaw,
          contentScope: ctx.user.role === "admin" ? "global" : "teacher",
          ownerTeacherId: ctx.user.role === "admin" ? null : ctx.user.id,
          createdByUserId: ctx.user.id,
          teacherId: ctx.user.id,
        });

        return { success: true };
      }),

    // تعديل تحدي
    update: protectedProcedure
      .input(z.object({
        id: z.number(),
        title: z.string().min(1).optional(),
        description: z.string().optional(),
        lessonId: z.number().int().positive().nullable().optional(),
        contentTermVisibility: z.enum(["all", "first", "second"]).optional(),
        classId: z.number().nullable().optional(),
        grade: z.string().nullable().optional(),
        isVisible: z.boolean().optional(),
        startDate: z.date().optional(),
        endDate: z.date().optional(),
        difficulty: z.enum(["easy", "medium", "hard"]).optional(),
        points: z.number().optional(),
        targetGender: z.enum(["all", "boys", "girls"]).optional(),
        imageUrl: z.string().optional(),
        badgeIconUrl: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "teacher" && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN" });
        }

        await assertTeacherFeatureAccess({
          user: ctx.user,
          featureCode: SUBSCRIPTION_FEATURES.createChallenge,
        });

        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const current = await database.select().from(challenges)
          .where(eq(challenges.id, input.id))
          .limit(1);

        if (!current[0]) {
          throw new TRPCError({ code: "NOT_FOUND", message: "التحدي غير موجود" });
        }

        const canEdit = current[0].teacherId === ctx.user.id || ctx.user.role === "admin";
        if (!canEdit) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }

        const { id, contentTermVisibility, ...data } = input;

        const requestedLessonId = Object.prototype.hasOwnProperty.call(data, "lessonId")
          ? (data.lessonId ?? null)
          : (current[0].lessonId ?? null);

        let inheritedTermId: number | null = null;
        let inheritedTermLabelRaw: string | null = null;
        if (requestedLessonId != null) {
          const lessonRows = await database
            .select({
              id: lessons.id,
              termId: lessons.termId,
              termLabelRaw: lessons.termLabelRaw,
              teacherId: lessons.teacherId,
              ownerTeacherId: lessons.ownerTeacherId,
            })
            .from(lessons)
            .where(eq(lessons.id, requestedLessonId))
            .limit(1);
          const linkedLesson = lessonRows[0];
          if (!linkedLesson) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "الدرس المرتبط غير موجود" });
          }

          if (ctx.user.role !== "admin") {
            const ownerId = Number(linkedLesson.ownerTeacherId || linkedLesson.teacherId || 0);
            if (ownerId !== Number(ctx.user.id)) {
              throw new TRPCError({ code: "FORBIDDEN", message: "لا تملك صلاحية ربط هذا الدرس" });
            }
          }

          inheritedTermId = linkedLesson.termId == null ? null : Number(linkedLesson.termId);
          inheritedTermLabelRaw = linkedLesson.termLabelRaw == null ? null : String(linkedLesson.termLabelRaw);
        }

        const explicitTermLabelRaw = contentTermVisibility
          ? fixedTermLabelFromVisibility(normalizeFixedTermVisibility(contentTermVisibility))
          : null;
        const effectiveTermId = requestedLessonId != null ? inheritedTermId : undefined;
        const effectiveTermLabelRaw = requestedLessonId != null
          ? inheritedTermLabelRaw
          : (contentTermVisibility ? explicitTermLabelRaw : undefined);

        await db.updateChallengeNew(id, data);

        if (effectiveTermId !== undefined || effectiveTermLabelRaw !== undefined) {
          await db.updateChallengeNew(id, {
            termId: effectiveTermId ?? null,
            termLabelRaw: effectiveTermLabelRaw ?? null,
          });
        }

        return { success: true };
      }),

    // حذف تحدي
    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "teacher" && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN" });
        }

        await assertTeacherFeatureAccess({
          user: ctx.user,
          featureCode: SUBSCRIPTION_FEATURES.createChallenge,
        });

        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const current = await database.select().from(challenges)
          .where(eq(challenges.id, input.id))
          .limit(1);

        if (!current[0]) {
          throw new TRPCError({ code: "NOT_FOUND", message: "التحدي غير موجود" });
        }

        const canDelete = current[0].teacherId === ctx.user.id || ctx.user.role === "admin";
        if (!canDelete) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }

        await database.delete(challengeSubmissions)
          .where(eq(challengeSubmissions.challengeId, input.id));

        await database.delete(challenges)
          .where(eq(challenges.id, input.id));

        return { success: true };
      }),

    // المشاركة في تحدي
    submit: protectedProcedure
      .input(z.object({
        challengeId: z.number(),
        artworkId: z.number(),
      }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role === "student" || ctx.user.role === "user") {
          const database = await getDb();
          if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
          const challengeRows = await database
            .select({ teacherId: challenges.teacherId, ownerTeacherId: challenges.ownerTeacherId })
            .from(challenges)
            .where(eq(challenges.id, input.challengeId))
            .limit(1);
          const ownerTeacherId = Number(
            challengeRows[0]?.ownerTeacherId || challengeRows[0]?.teacherId || 0,
          );
          await assertStudentPaidFeatureAccess({
            studentId: ctx.user.id,
            featureCode: SUBSCRIPTION_FEATURES.createChallenge,
            ownerTeacherId: ownerTeacherId > 0 ? ownerTeacherId : undefined,
          });
        }

        await db.submitChallengeArtworkNew({
          challengeId: input.challengeId,
          studentId: ctx.user.id,
          artworkId: input.artworkId,
        });

        if (ctx.user.role === "student" || ctx.user.role === "user") {
          await maybeAwardChallengeFinisher(ctx.user.id);
        }

        return { success: true };
      }),

    // الحصول على مشاركات تحدي
    getSubmissions: protectedProcedure
      .input(z.object({ challengeId: z.number() }))
      .query(async ({ input }) => {
        return db.getChallengeSubmissions(input.challengeId);
      }),

    updateSubmissionStatus: protectedProcedure
      .input(
        z.object({
          challengeId: z.number(),
          artworkId: z.number(),
          status: z.enum(["pending", "approved", "rejected"]),
        })
      )
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "teacher" && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN" });
        }

        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const challengeRows = await database
          .select({ teacherId: challenges.teacherId })
          .from(challenges)
          .where(eq(challenges.id, input.challengeId))
          .limit(1);

        const challenge = challengeRows[0];
        if (!challenge) {
          throw new TRPCError({ code: "NOT_FOUND", message: "المهمة غير موجودة" });
        }

        if (ctx.user.role === "teacher" && challenge.teacherId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN", message: "غير مصرح لك بتحديث هذا التسليم" });
        }

        await database
          .update(challengeSubmissions)
          .set({ status: input.status })
          .where(
            and(
              eq(challengeSubmissions.challengeId, input.challengeId),
              eq(challengeSubmissions.artworkId, input.artworkId)
            )
          );

        return { success: true };
      }),

    getForStudent: protectedProcedure.query(async ({ ctx }) => {
      const database = await getDb();
      if (!database) return [];

      const studentClassRows = await database
        .select({
          classId: classStudents.classId,
          grade: classes.grade,
          teacherId: classes.teacherId,
          studentContentTermVisibility: classes.studentContentTermVisibility,
        })
        .from(classStudents)
        .innerJoin(classes, eq(classStudents.classId, classes.id))
        .where(eq(classStudents.studentId, ctx.user.id));

      if (studentClassRows.length === 0) return [];

      const classIds = Array.from(new Set(studentClassRows.map((row) => row.classId)));
      const classPolicyById = new Map<number, FixedTermVisibility>();
      for (const row of studentClassRows) {
        classPolicyById.set(Number(row.classId), normalizeFixedTermVisibility(row.studentContentTermVisibility));
      }
      const classPolicies = Array.from(classPolicyById.values());
      const teacherIds = Array.from(new Set(studentClassRows.map((row) => row.teacherId)));
      const normalizedStudentGrades = new Set(
        studentClassRows
          .map((row) => normalizeGradeKey(String(row.grade || "")))
          .filter(Boolean)
      );
      const canonicalStudentGradeIds = await resolveCanonicalGradeIds(
        database,
        studentClassRows.map((row) => row.grade),
      );
      const now = new Date();

      const visibilityConditions: SQL<unknown>[] = [
        inArray(challenges.classId, classIds),
        isNull(challenges.classId),
      ].filter(isDefinedSql);

      const result = await database
        .select()
        .from(challenges)
        .where(
          and(
            lte(challenges.startDate, now),
            gte(challenges.endDate, now),
            or(eq(challenges.isVisible, true), isNull(challenges.isVisible)),
            or(...visibilityConditions)
          )
        )
        .orderBy(desc(challenges.createdAt));

      const linkedLessonIds = Array.from(
        new Set(
          result
            .map((item) => Number(item.lessonId || 0))
            .filter((id) => id > 0)
        )
      );
      const linkedLessons = linkedLessonIds.length
        ? await database
            .select({ id: lessons.id, termId: lessons.termId, termLabelRaw: lessons.termLabelRaw })
            .from(lessons)
            .where(inArray(lessons.id, linkedLessonIds))
        : [];
      const linkedLessonTermById = new Map<number, { termId: number | null; termLabelRaw: string | null }>();
      for (const row of linkedLessons) {
        linkedLessonTermById.set(Number(row.id), {
          termId: row.termId == null ? null : Number(row.termId),
          termLabelRaw: row.termLabelRaw == null ? null : String(row.termLabelRaw),
        });
      }

      return result.filter((challengeItem) => {
        const linkedLessonTerm = linkedLessonTermById.get(Number(challengeItem.lessonId || 0));
        const contentTerm = linkedLessonTerm
          ? extractFixedTermFromContent(linkedLessonTerm)
          : extractFixedTermFromContent({
              termId: challengeItem.termId,
              termLabelRaw: challengeItem.termLabelRaw,
            });
        if (challengeItem.classId != null) {
          if (!classIds.includes(Number(challengeItem.classId))) return false;
          const classPolicy = classPolicyById.get(Number(challengeItem.classId));
          if (!classPolicy) return false;
          return isContentTermAllowedByClassPolicy({ classPolicy, contentTerm });
        }

        if (!isContentTermAllowedByStudentClasses({ classPolicies, contentTerm })) {
          return false;
        }

        const gradeMatches = matchesGradeCanonicalFirst({
          itemGradeId: challengeItem.gradeId,
          itemGradeRaw: challengeItem.grade,
          canonicalGradeIds: canonicalStudentGradeIds,
          normalizedLegacyGrades: normalizedStudentGrades,
        });
        const isGlobal = challengeItem.contentScope === "global" || (challengeItem.ownerTeacherId == null && challengeItem.classId == null);
        if (isGlobal) {
          return gradeMatches;
        }

        const ownerId = Number(challengeItem.ownerTeacherId || challengeItem.teacherId || 0);
        const belongsToMyTeacher = ownerId > 0 && teacherIds.includes(ownerId);
        return belongsToMyTeacher && gradeMatches;
      });
    }),
  }),

  teacherCompetitions: router({
    listMine: protectedProcedure.query(async ({ ctx }) => {
      const database = await getDb();
      if (!database) return [];
      const rows = ctx.user.role === "admin"
        ? await database
            .select({ ...getTableColumns(teacherCompetitions), teacherName: users.name })
            .from(teacherCompetitions)
            .leftJoin(users, eq(users.id, teacherCompetitions.teacherId))
            .orderBy(desc(teacherCompetitions.createdAt))
        : await database
            .select({ ...getTableColumns(teacherCompetitions), teacherName: users.name })
            .from(teacherCompetitions)
            .leftJoin(users, eq(users.id, teacherCompetitions.teacherId))
            .where(eq(teacherCompetitions.teacherId, ctx.user.id))
            .orderBy(desc(teacherCompetitions.createdAt));
      return rows;
    }),

    getDetails: protectedProcedure
      .input(z.object({ competitionId: z.number() }))
      .query(async ({ ctx, input }) => {
        const database = await getDb();
        if (!database) return null;
        const rows = await database.select().from(teacherCompetitions).where(eq(teacherCompetitions.id, input.competitionId)).limit(1);
        const competition = rows[0];
        if (!competition) return null;
        if (ctx.user.role !== "admin" && Number(competition.teacherId) !== Number(ctx.user.id)) {
          throw new TRPCError({ code: "FORBIDDEN", message: "لا يمكنك إدارة مسابقة معلم آخر" });
        }
        const submissions = await database
          .select()
          .from(competitionSubmissions)
          .where(eq(competitionSubmissions.competitionId, input.competitionId))
          .orderBy(desc(competitionSubmissions.createdAt));
        return { competition, submissions };
      }),

    create: protectedProcedure
      .input(z.object({
        title: z.string().min(3).max(255),
        description: z.string().max(5000).optional(),
        coverImageUrl: z.string().max(5000).optional(),
        targetGrade: z.string().max(80).optional(),
        targetClassId: z.number().nullable().optional(),
        startDate: z.coerce.date().nullable().optional(),
        endDate: z.coerce.date().nullable().optional(),
        status: z.enum(["draft", "active", "closed", "published", "archived"]).default("draft"),
        isPublic: z.boolean().default(false),
        allowStudentSubmissions: z.boolean().default(false),
      }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "teacher" && ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        if (input.startDate && input.endDate && input.endDate <= input.startDate) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "تاريخ النهاية يجب أن يكون بعد البداية" });
        }
        const teacherId = ctx.user.id;
        if (input.targetClassId) {
          const classRows = await database.select({ id: classes.id }).from(classes).where(and(eq(classes.id, input.targetClassId), eq(classes.teacherId, teacherId))).limit(1);
          if (!classRows[0]) throw new TRPCError({ code: "BAD_REQUEST", message: "الفصل المحدد غير تابع لك" });
        }
        await database.insert(teacherCompetitions).values({
          teacherId,
          title: input.title.trim(),
          description: String(input.description || "").trim(),
          coverImageUrl: String(input.coverImageUrl || "").trim(),
          targetGrade: String(input.targetGrade || "").trim() || null,
          targetClassId: input.targetClassId || null,
          startDate: input.startDate || null,
          endDate: input.endDate || null,
          status: input.status,
          isPublic: input.isPublic,
          allowStudentSubmissions: input.allowStudentSubmissions,
        });
        return { success: true };
      }),

    update: protectedProcedure
      .input(z.object({
        competitionId: z.number(),
        title: z.string().min(3).max(255),
        description: z.string().max(5000).optional(),
        coverImageUrl: z.string().max(5000).optional(),
        targetGrade: z.string().max(80).optional(),
        targetClassId: z.number().nullable().optional(),
        startDate: z.coerce.date().nullable().optional(),
        endDate: z.coerce.date().nullable().optional(),
        status: z.enum(["draft", "active", "closed", "published", "archived"]),
        isPublic: z.boolean(),
        allowStudentSubmissions: z.boolean(),
      }))
      .mutation(async ({ ctx, input }) => {
        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const rows = await database.select().from(teacherCompetitions).where(eq(teacherCompetitions.id, input.competitionId)).limit(1);
        const competition = rows[0];
        if (!competition) throw new TRPCError({ code: "NOT_FOUND", message: "المسابقة غير موجودة" });
        if (ctx.user.role !== "admin" && Number(competition.teacherId) !== Number(ctx.user.id)) throw new TRPCError({ code: "FORBIDDEN" });
        if (input.startDate && input.endDate && input.endDate <= input.startDate) throw new TRPCError({ code: "BAD_REQUEST", message: "تاريخ النهاية يجب أن يكون بعد البداية" });
        await database.update(teacherCompetitions).set({
          title: input.title.trim(),
          description: String(input.description || "").trim(),
          coverImageUrl: String(input.coverImageUrl || "").trim(),
          targetGrade: String(input.targetGrade || "").trim() || null,
          targetClassId: input.targetClassId || null,
          startDate: input.startDate || null,
          endDate: input.endDate || null,
          status: input.status,
          isPublic: input.isPublic,
          allowStudentSubmissions: input.allowStudentSubmissions,
          updatedAt: new Date(),
        }).where(eq(teacherCompetitions.id, input.competitionId));
        return { success: true };
      }),

    delete: protectedProcedure
      .input(z.object({ competitionId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const rows = await database.select().from(teacherCompetitions).where(eq(teacherCompetitions.id, input.competitionId)).limit(1);
        const competition = rows[0];
        if (!competition) throw new TRPCError({ code: "NOT_FOUND" });
        if (ctx.user.role !== "admin" && Number(competition.teacherId) !== Number(ctx.user.id)) throw new TRPCError({ code: "FORBIDDEN" });
        await database.delete(competitionSubmissions).where(eq(competitionSubmissions.competitionId, input.competitionId));
        await database.delete(teacherCompetitions).where(eq(teacherCompetitions.id, input.competitionId));
        return { success: true };
      }),

    archive: protectedProcedure
      .input(z.object({ competitionId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const rows = await database.select().from(teacherCompetitions).where(eq(teacherCompetitions.id, input.competitionId)).limit(1);
        const competition = rows[0];
        if (!competition) throw new TRPCError({ code: "NOT_FOUND" });
        if (ctx.user.role !== "admin" && Number(competition.teacherId) !== Number(ctx.user.id)) throw new TRPCError({ code: "FORBIDDEN" });
        await database
          .update(teacherCompetitions)
          .set({
            status: "archived",
            isPublic: false,
            allowStudentSubmissions: false,
            updatedAt: new Date(),
          })
          .where(eq(teacherCompetitions.id, input.competitionId));
        return { success: true };
      }),

    uploadImage: protectedProcedure
      .input(z.object({ imageData: z.string().min(1), fileName: z.string().optional(), mimeType: z.string().optional(), kind: z.enum(["cover", "submission"]).default("submission") }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "teacher" && ctx.user.role !== "admin" && ctx.user.role !== "student") throw new TRPCError({ code: "FORBIDDEN" });
        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const uploaded = await uploadCompetitionImage(database, {
          imageData: input.imageData,
          fileName: input.fileName,
          mimeType: input.mimeType,
          scope: input.kind,
          sourceType: input.kind === "cover" ? "teacher_competition_cover" : "teacher_competition_submission",
        });
        return { success: true, url: uploaded.url };
      }),

    addSubmission: protectedProcedure
      .input(z.object({
        competitionId: z.number(),
        studentId: z.number().nullable().optional(),
        studentName: z.string().min(2).max(255),
        artworkTitle: z.string().min(2).max(255),
        imageUrl: z.string().min(1).max(5000),
        grade: z.string().max(80).optional(),
        className: z.string().max(255).optional(),
        description: z.string().max(5000).optional(),
        teacherNotes: z.string().max(5000).optional(),
        status: z.enum(["pending", "approved", "rejected", "winner", "featured"]).default("approved"),
        awardRank: z.enum(["first", "second", "third"]).nullable().optional(),
        isFeatured: z.boolean().default(false),
      }))
      .mutation(async ({ ctx, input }) => {
        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const rows = await database.select().from(teacherCompetitions).where(eq(teacherCompetitions.id, input.competitionId)).limit(1);
        const competition = rows[0];
        if (!competition) throw new TRPCError({ code: "NOT_FOUND", message: "المسابقة غير موجودة" });
        if (ctx.user.role !== "admin" && Number(competition.teacherId) !== Number(ctx.user.id)) throw new TRPCError({ code: "FORBIDDEN" });
        await database.insert(competitionSubmissions).values({
          competitionId: input.competitionId,
          teacherId: competition.teacherId,
          studentId: input.studentId || null,
          studentName: input.studentName.trim(),
          artworkTitle: input.artworkTitle.trim(),
          imageUrl: input.imageUrl.trim(),
          grade: String(input.grade || "").trim() || null,
          className: String(input.className || "").trim() || null,
          description: String(input.description || "").trim(),
          teacherNotes: String(input.teacherNotes || "").trim(),
          status: input.status,
          awardRank: input.awardRank || null,
          isFeatured: input.isFeatured,
        });
        return { success: true };
      }),

    updateSubmission: protectedProcedure
      .input(z.object({
        submissionId: z.number(),
        studentName: z.string().min(2).max(255),
        artworkTitle: z.string().min(2).max(255),
        imageUrl: z.string().min(1).max(5000),
        grade: z.string().max(80).optional(),
        className: z.string().max(255).optional(),
        description: z.string().max(5000).optional(),
        teacherNotes: z.string().max(5000).optional(),
        status: z.enum(["pending", "approved", "rejected", "winner", "featured"]),
        awardRank: z.enum(["first", "second", "third"]).nullable().optional(),
        isFeatured: z.boolean(),
      }))
      .mutation(async ({ ctx, input }) => {
        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const rows = await database.select().from(competitionSubmissions).where(eq(competitionSubmissions.id, input.submissionId)).limit(1);
        const submission = rows[0];
        if (!submission) throw new TRPCError({ code: "NOT_FOUND" });
        if (ctx.user.role !== "admin" && Number(submission.teacherId) !== Number(ctx.user.id)) throw new TRPCError({ code: "FORBIDDEN" });
        await database.update(competitionSubmissions).set({
          studentName: input.studentName.trim(),
          artworkTitle: input.artworkTitle.trim(),
          imageUrl: input.imageUrl.trim(),
          grade: String(input.grade || "").trim() || null,
          className: String(input.className || "").trim() || null,
          description: String(input.description || "").trim(),
          teacherNotes: String(input.teacherNotes || "").trim(),
          status: input.status,
          awardRank: input.awardRank || null,
          isFeatured: input.isFeatured,
          updatedAt: new Date(),
        }).where(eq(competitionSubmissions.id, input.submissionId));
        return { success: true };
      }),

    deleteSubmission: protectedProcedure
      .input(z.object({ submissionId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const rows = await database.select().from(competitionSubmissions).where(eq(competitionSubmissions.id, input.submissionId)).limit(1);
        const submission = rows[0];
        if (!submission) throw new TRPCError({ code: "NOT_FOUND" });
        if (ctx.user.role !== "admin" && Number(submission.teacherId) !== Number(ctx.user.id)) throw new TRPCError({ code: "FORBIDDEN" });
        await database.delete(competitionSubmissions).where(eq(competitionSubmissions.id, input.submissionId));
        return { success: true };
      }),

    submitAsStudent: protectedProcedure
      .input(z.object({ competitionId: z.number(), artworkTitle: z.string().min(2).max(255), imageUrl: z.string().min(1).max(5000), description: z.string().max(5000).optional() }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "student") throw new TRPCError({ code: "FORBIDDEN" });
        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const rows = await database.select().from(teacherCompetitions).where(eq(teacherCompetitions.id, input.competitionId)).limit(1);
        const competition = rows[0];
        if (!competition || competition.status === "archived" || !competition.allowStudentSubmissions) throw new TRPCError({ code: "FORBIDDEN", message: "المشاركة الطلابية غير متاحة لهذه المسابقة" });
        const studentRows = await database
          .select({ className: classes.name, grade: classes.grade })
          .from(classStudents)
          .innerJoin(classes, eq(classStudents.classId, classes.id))
          .where(and(eq(classStudents.studentId, ctx.user.id), eq(classes.teacherId, competition.teacherId)))
          .limit(1);
        const studentClass = studentRows[0];
        if (!studentClass) throw new TRPCError({ code: "FORBIDDEN", message: "هذه المسابقة ليست ضمن فصولك" });
        await database.insert(competitionSubmissions).values({
          competitionId: competition.id,
          teacherId: competition.teacherId,
          studentId: ctx.user.id,
          studentName: ctx.user.name || "طالب",
          artworkTitle: input.artworkTitle.trim(),
          imageUrl: input.imageUrl.trim(),
          grade: studentClass.grade || null,
          className: studentClass.className || null,
          description: String(input.description || "").trim(),
          teacherNotes: "",
          status: "pending",
          awardRank: null,
          isFeatured: false,
        });
        return { success: true };
      }),

    getPublicById: publicProcedure
      .input(z.object({ competitionId: z.number() }))
      .query(async ({ input }) => {
        const database = await getDb();
        if (!database) return null;
        const rows = await database
          .select({ ...getTableColumns(teacherCompetitions), teacherName: users.name })
          .from(teacherCompetitions)
          .leftJoin(users, eq(users.id, teacherCompetitions.teacherId))
          .where(eq(teacherCompetitions.id, input.competitionId))
          .limit(1);
        const competition = rows[0];
        if (!competition || !competition.isPublic || !["active", "published", "closed"].includes(String(competition.status))) return null;
        const submissions = await database
          .select()
          .from(competitionSubmissions)
          .where(and(eq(competitionSubmissions.competitionId, input.competitionId), publicSubmissionWhere()!))
          .orderBy(desc(competitionSubmissions.isFeatured), desc(competitionSubmissions.createdAt));
        return { competition, submissions };
      }),

    getPreviewById: publicProcedure
      .input(z.object({ competitionId: z.number() }))
      .query(async ({ ctx, input }) => {
        const database = await getDb();
        if (!database) return null;
        const rows = await database
          .select({ ...getTableColumns(teacherCompetitions), teacherName: users.name })
          .from(teacherCompetitions)
          .leftJoin(users, eq(users.id, teacherCompetitions.teacherId))
          .where(eq(teacherCompetitions.id, input.competitionId))
          .limit(1);
        const competition = rows[0];
        if (!competition) return null;

        const canPreview = Boolean(
          ctx.user && (ctx.user.role === "admin" || Number(competition.teacherId) === Number(ctx.user.id)),
        );
        if (!canPreview && (!competition.isPublic || !["active", "published", "closed"].includes(String(competition.status)))) {
          return null;
        }

        const submissions = canPreview
          ? await database
              .select()
              .from(competitionSubmissions)
              .where(eq(competitionSubmissions.competitionId, input.competitionId))
              .orderBy(desc(competitionSubmissions.isFeatured), desc(competitionSubmissions.createdAt))
          : await database
              .select()
              .from(competitionSubmissions)
              .where(and(eq(competitionSubmissions.competitionId, input.competitionId), publicSubmissionWhere()!))
              .orderBy(desc(competitionSubmissions.isFeatured), desc(competitionSubmissions.createdAt));
        return { competition, submissions, canPreview };
      }),

    getPublicForTeacher: publicProcedure
      .input(z.object({ teacherId: z.number() }))
      .query(async ({ input }) => {
        const database = await getDb();
        if (!database) return [];
        return database
          .select({
            id: teacherCompetitions.id,
            title: teacherCompetitions.title,
            description: teacherCompetitions.description,
            coverImageUrl: teacherCompetitions.coverImageUrl,
            status: teacherCompetitions.status,
            startDate: teacherCompetitions.startDate,
            endDate: teacherCompetitions.endDate,
            submissionsCount: sql<number>`count(${competitionSubmissions.id})`,
          })
          .from(teacherCompetitions)
          .leftJoin(competitionSubmissions, and(eq(competitionSubmissions.competitionId, teacherCompetitions.id), publicSubmissionWhere()!))
          .where(and(eq(teacherCompetitions.teacherId, input.teacherId), eq(teacherCompetitions.isPublic, true), inArray(teacherCompetitions.status, ["active", "published", "closed"])))
          .groupBy(teacherCompetitions.id)
          .orderBy(desc(teacherCompetitions.createdAt));
      }),
  }),

  competitions: router({
    getActive: publicProcedure.query(async () => {
      const database = await getDb();
      if (!database) return [];

      const now = new Date();
      return database
        .select()
        .from(competitions)
        .where(and(eq(competitions.isActive, true), lte(competitions.startDate, now), gte(competitions.endDate, now)))
        .orderBy(desc(competitions.createdAt));
    }),

    getById: publicProcedure
      .input(
        z.object({
          competitionId: z.number(),
          sortBy: z.enum(["most_votes", "newest", "featured"]).default("most_votes"),
        })
      )
      .query(async ({ input }) => {
        const database = await getDb();
        if (!database) {
          return { competition: null, artworks: [] };
        }

        const competitionRows = await database
          .select()
          .from(competitions)
          .where(eq(competitions.id, input.competitionId))
          .limit(1);

        const competition = competitionRows[0] || null;
        if (!competition) {
          return { competition: null, artworks: [] };
        }

        const baseQuery = database
          .select({
            ...getTableColumns(artworks),
            studentName: users.name,
            className: classes.name,
            competitionPlace: sql<CompetitionPlace>`(
              case
                when artworks.id = ${competition.firstPlaceArtworkId ?? 0} then 'first'
                when artworks.id = ${competition.secondPlaceArtworkId ?? 0} then 'second'
                when artworks.id = ${competition.thirdPlaceArtworkId ?? 0} then 'third'
                else null
              end
            )`,
          })
          .from(artworks)
          .leftJoin(users, eq(artworks.studentId, users.id))
          .leftJoin(classes, eq(artworks.classId, classes.id))
          .where(
            and(
              eq(artworks.competitionId, input.competitionId),
              eq(artworks.showInCompetition, true),
              eq(artworks.isPublic, true),
              inArray(artworks.status, ["submitted", "reviewed", "published"])
            )
          );

        const artworksRows =
          input.sortBy === "newest"
            ? await baseQuery.orderBy(desc(artworks.createdAt), desc(artworks.competitionVotes), desc(artworks.isFeatured))
            : input.sortBy === "featured"
              ? await baseQuery.orderBy(desc(artworks.isFeatured), desc(artworks.competitionVotes), desc(artworks.createdAt))
              : await baseQuery.orderBy(desc(artworks.competitionVotes), desc(artworks.isFeatured), desc(artworks.createdAt));

        return {
          competition,
          artworks: artworksRows,
        };
      }),

    getAdminList: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "هذه الصفحة متاحة للإدارة فقط" });
      }

      const database = await getDb();
      if (!database) return [];

      return database.select().from(competitions).orderBy(desc(competitions.createdAt));
    }),

    create: protectedProcedure
      .input(
        z.object({
          title: z.string().min(1),
          description: z.string().optional(),
          startDate: z.date(),
          endDate: z.date(),
          isActive: z.boolean().default(false),
        })
      )
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "الإدارة فقط يمكنها إنشاء المسابقات" });
        }

        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        if (input.endDate < input.startDate) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "تاريخ نهاية المسابقة يجب أن يكون بعد تاريخ البداية" });
        }

        await database.insert(competitions).values({
          title: input.title.trim(),
          description: input.description,
          startDate: input.startDate,
          endDate: input.endDate,
          isActive: input.isActive,
        });

        return { success: true };
      }),

    update: protectedProcedure
      .input(
        z.object({
          competitionId: z.number(),
          title: z.string().min(1).optional(),
          description: z.string().optional(),
          startDate: z.date().optional(),
          endDate: z.date().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "الإدارة فقط يمكنها تعديل المسابقات" });
        }

        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const existing = await database
          .select()
          .from(competitions)
          .where(eq(competitions.id, input.competitionId))
          .limit(1);

        if (!existing[0]) {
          throw new TRPCError({ code: "NOT_FOUND", message: "المسابقة غير موجودة" });
        }

        const nextStart = input.startDate ?? existing[0].startDate;
        const nextEnd = input.endDate ?? existing[0].endDate;
        if (nextEnd < nextStart) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "تاريخ نهاية المسابقة يجب أن يكون بعد تاريخ البداية" });
        }

        await database
          .update(competitions)
          .set({
            title: input.title?.trim(),
            description: input.description,
            startDate: input.startDate,
            endDate: input.endDate,
          })
          .where(eq(competitions.id, input.competitionId));

        return { success: true };
      }),

    setActive: protectedProcedure
      .input(z.object({ competitionId: z.number(), isActive: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "الإدارة فقط يمكنها تفعيل/إغلاق المسابقات" });
        }

        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        await database
          .update(competitions)
          .set({ isActive: input.isActive })
          .where(eq(competitions.id, input.competitionId));

        return { success: true };
      }),

    delete: protectedProcedure
      .input(z.object({ competitionId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "الإدارة فقط يمكنها حذف المسابقات" });
        }

        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const existing = await database
          .select({ id: competitions.id })
          .from(competitions)
          .where(eq(competitions.id, input.competitionId))
          .limit(1);

        if (!existing[0]) {
          throw new TRPCError({ code: "NOT_FOUND", message: "المسابقة غير موجودة" });
        }

        await database
          .update(artworks)
          .set({
            showInCompetition: false,
            competitionId: null,
            competitionVotes: 0,
          })
          .where(eq(artworks.competitionId, input.competitionId));

        await database
          .delete(competitionArtworkVotes)
          .where(eq(competitionArtworkVotes.competitionId, input.competitionId));

        await database
          .delete(competitions)
          .where(eq(competitions.id, input.competitionId));

        return { success: true };
      }),

    assignArtwork: protectedProcedure
      .input(z.object({ competitionId: z.number(), artworkId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "الإدارة فقط يمكنها إضافة الأعمال للمسابقة" });
        }

        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const competitionRows = await database
          .select({ id: competitions.id })
          .from(competitions)
          .where(eq(competitions.id, input.competitionId))
          .limit(1);
        if (!competitionRows[0]) {
          throw new TRPCError({ code: "NOT_FOUND", message: "المسابقة غير موجودة" });
        }

        const artworkRows = await database
          .select({ id: artworks.id, studentId: artworks.studentId, isPublic: artworks.isPublic, status: artworks.status })
          .from(artworks)
          .where(eq(artworks.id, input.artworkId))
          .limit(1);

        const artwork = artworkRows[0];
        if (!artwork) {
          throw new TRPCError({ code: "NOT_FOUND", message: "العمل الفني غير موجود" });
        }

        if (!artwork.isPublic || artwork.status === "draft") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "لا يمكن إضافة عمل غير معتمد من المعلم إلى المسابقة" });
        }

        await database
          .update(artworks)
          .set({
            showInCompetition: true,
            competitionId: input.competitionId,
            competitionVotes: 0,
          })
          .where(eq(artworks.id, input.artworkId));

        await database
          .update(competitions)
          .set({
            firstPlaceArtworkId: sql`if(${competitions.firstPlaceArtworkId} = ${input.artworkId}, null, ${competitions.firstPlaceArtworkId})`,
            secondPlaceArtworkId: sql`if(${competitions.secondPlaceArtworkId} = ${input.artworkId}, null, ${competitions.secondPlaceArtworkId})`,
            thirdPlaceArtworkId: sql`if(${competitions.thirdPlaceArtworkId} = ${input.artworkId}, null, ${competitions.thirdPlaceArtworkId})`,
          })
          .where(eq(competitions.id, input.competitionId));

        await maybeAwardCompetitionParticipant(artwork.studentId);

        return { success: true };
      }),

    removeArtwork: protectedProcedure
      .input(z.object({ competitionId: z.number(), artworkId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "الإدارة فقط يمكنها إزالة الأعمال من المسابقة" });
        }

        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        await database
          .update(artworks)
          .set({
            showInCompetition: false,
            competitionId: null,
            competitionVotes: 0,
          })
          .where(and(eq(artworks.id, input.artworkId), eq(artworks.competitionId, input.competitionId)));

        await database
          .delete(competitionArtworkVotes)
          .where(and(eq(competitionArtworkVotes.competitionId, input.competitionId), eq(competitionArtworkVotes.artworkId, input.artworkId)));

        await database
          .update(competitions)
          .set({
            firstPlaceArtworkId: sql`if(${competitions.firstPlaceArtworkId} = ${input.artworkId}, null, ${competitions.firstPlaceArtworkId})`,
            secondPlaceArtworkId: sql`if(${competitions.secondPlaceArtworkId} = ${input.artworkId}, null, ${competitions.secondPlaceArtworkId})`,
            thirdPlaceArtworkId: sql`if(${competitions.thirdPlaceArtworkId} = ${input.artworkId}, null, ${competitions.thirdPlaceArtworkId})`,
          })
          .where(eq(competitions.id, input.competitionId));

        return { success: true };
      }),

    finalizeWinners: protectedProcedure
      .input(
        z.object({
          competitionId: z.number(),
          firstPlaceArtworkId: z.number(),
          secondPlaceArtworkId: z.number(),
          thirdPlaceArtworkId: z.number(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "الإدارة فقط يمكنها اعتماد الفائزين" });
        }

        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const uniqueIds = new Set([input.firstPlaceArtworkId, input.secondPlaceArtworkId, input.thirdPlaceArtworkId]);
        if (uniqueIds.size < 3) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "يجب اختيار أعمال مختلفة للمراكز الثلاثة" });
        }

        const participantRows = await database
          .select({ id: artworks.id, studentId: artworks.studentId })
          .from(artworks)
          .where(and(eq(artworks.competitionId, input.competitionId), eq(artworks.showInCompetition, true)));

        const participantIds = new Set(participantRows.map((row) => row.id));
        if (
          !participantIds.has(input.firstPlaceArtworkId) ||
          !participantIds.has(input.secondPlaceArtworkId) ||
          !participantIds.has(input.thirdPlaceArtworkId)
        ) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "كل مركز يجب أن يكون لعمل مشارك في نفس المسابقة" });
        }

        await database
          .update(competitions)
          .set({
            firstPlaceArtworkId: input.firstPlaceArtworkId,
            secondPlaceArtworkId: input.secondPlaceArtworkId,
            thirdPlaceArtworkId: input.thirdPlaceArtworkId,
            finalizedAt: new Date(),
            isActive: false,
          })
          .where(eq(competitions.id, input.competitionId));

        const artworkById = new Map(participantRows.map((row) => [row.id, row] as const));
        const firstWinner = artworkById.get(input.firstPlaceArtworkId);
        const secondWinner = artworkById.get(input.secondPlaceArtworkId);
        const thirdWinner = artworkById.get(input.thirdPlaceArtworkId);

        for (const participant of participantRows) {
          await maybeAwardCompetitionParticipant(participant.studentId);
        }

        if (firstWinner) {
          await maybeAwardCompetitionWinner(firstWinner.studentId);
          await maybeAwardFirstPlaceArtist(firstWinner.studentId);
        }
        if (secondWinner) {
          await maybeAwardCompetitionWinner(secondWinner.studentId);
        }
        if (thirdWinner) {
          await maybeAwardCompetitionWinner(thirdWinner.studentId);
        }

        await maybeAwardPopularArtworkForCompetition(input.competitionId);

        return { success: true };
      }),
  }),

  // التصويت على الأعمال الفنية
  votes: router({
    // التصويت على عمل فني
    vote: protectedProcedure
      .input(z.object({ artworkId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        try {
          await db.voteForArtwork(input.artworkId, ctx.user.id);
          return { success: true };
        } catch (error: any) {
          throw new TRPCError({ 
            code: "BAD_REQUEST", 
            message: error.message 
          });
        }
      }),

    // الحصول على عدد الأصوات
    getCount: publicProcedure
      .input(z.object({ artworkId: z.number() }))
      .query(async ({ input }) => {
        return db.getArtworkVotes(input.artworkId);
      }),

    // التحقق من التصويت
    hasVoted: protectedProcedure
      .input(z.object({ artworkId: z.number() }))
      .query(async ({ ctx, input }) => {
        return db.hasUserVoted(input.artworkId, ctx.user.id);
      }),
  }),

  // التقييمات والتعليقات
  reviews: router({
    // إضافة تقييم
    create: protectedProcedure
      .input(z.object({
        artworkId: z.number(),
        rating: z.number().min(1).max(5).optional(),
        comment: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "teacher" && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN" });
        }

        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        await db.createReviewNew({
          artworkId: input.artworkId,
          teacherId: ctx.user.id,
          rating: input.rating,
          comment: input.comment,
        });

        const artworkRows = await database
          .select({ id: artworks.id, status: artworks.status, studentId: artworks.studentId })
          .from(artworks)
          .where(eq(artworks.id, input.artworkId))
          .limit(1);

        const artwork = artworkRows[0];
        if (artwork && artwork.status !== "published") {
          await database
            .update(artworks)
            .set({ status: "reviewed" })
            .where(eq(artworks.id, input.artworkId));
        }

        if (artwork?.studentId) {
          await maybeAwardFirstReviewedArtwork(artwork.studentId);
        }

        return { success: true };
      }),

    // الحصول على تقييمات عمل فني
    getByArtwork: publicProcedure
      .input(z.object({ artworkId: z.number() }))
      .query(async ({ input }) => {
        return db.getArtworkReviews(input.artworkId);
      }),
  }),

    // البيانات الشخصية للمعلمين
  teacherProfile: router({
    // الحصول على البيانات الشخصية
    get: protectedProcedure.query(async ({ ctx }) => {
      const profile = await db.getTeacherProfile(ctx.user.id);
      return {
        ...(profile || {}),
        contactEmail: ctx.user.email || "",
      };
    }),

    // حفظ أو تحديث البيانات الشخصية
    upsert: protectedProcedure
      .input(z.object({
        teacherName: z.string().optional(),
        teacherDisplayName: z.string().optional(),
        teacherGender: z.enum(["male", "female"]).optional(),
        teacherSignature: z.string().optional(),
        schoolName: z.string().optional(),
        schoolType: z.enum(["boys", "girls"]).optional(),
        educationOffice: z.string().optional(),
        educationLevel: z.string().optional(),
        contactEmail: z.string().trim().email().or(z.literal("")).optional(),
        principalDisplayName: z.string().optional(),
        principalGender: z.enum(["male", "female"]).optional(),
        principalSignature: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const { contactEmail: _contactEmail, ...profileInput } = input;
        const currentUserRows = await database
          .select({ name: users.name, openId: users.openId })
          .from(users)
          .where(eq(users.id, ctx.user.id))
          .limit(1);
        const previousDisplayName = String(currentUserRows[0]?.name || "").trim();

        await db.upsertTeacherProfile({
          teacherId: ctx.user.id,
          ...profileInput,
        });

        const displayName = String(input.teacherName || input.teacherDisplayName || "").trim();
        const contactEmail = typeof input.contactEmail === "string" ? input.contactEmail.trim() : undefined;
        const userPatch: Record<string, unknown> = {};
        if (displayName) {
          userPatch.name = displayName;
        }
        if (contactEmail !== undefined) {
          userPatch.email = contactEmail || null;
        }
        if (Object.keys(userPatch).length > 0) {
          await database.update(users).set(userPatch).where(eq(users.id, ctx.user.id));
        }
        if (displayName && displayName !== previousDisplayName) {
          await logAdminAction(ctx, {
            action: "update_teacher_display_name",
            targetOpenId: currentUserRows[0]?.openId || ctx.user.openId,
            details: "تم تحديث الاسم الظاهر للمعلم.",
          });
        }

        return { success: true };
      }),
  }),

  // تقييمات الدروس
  lessonRatings: router({
    // إضافة أو تحديث تقييم
    rate: protectedProcedure
      .input(
        z.object({
          lessonId: z.number(),
          rating: z.number().min(1).max(5),
          comment: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { createLessonRating, getUserLessonRating, updateLessonRating } = await import("./db");

        // التحقق من وجود تقييم سابق
        const existing = await getUserLessonRating(input.lessonId, ctx.user.id);

        if (existing) {
          // تحديث التقييم الموجود
          await updateLessonRating(existing.id, {
            rating: input.rating,
            comment: input.comment,
          });
        } else {
          // إضافة تقييم جديد
          await createLessonRating({
            lessonId: input.lessonId,
            userId: ctx.user.id,
            rating: input.rating,
            comment: input.comment,
          });
        }

        return { success: true };
      }),

    // الحصول على تقييمات درس
    getByLesson: publicProcedure
      .input(z.object({ lessonId: z.number() }))
      .query(async ({ input }) => {
        const { getLessonRatings, getLessonAverageRating } = await import("./db");
        const ratings = await getLessonRatings(input.lessonId);
        const stats = await getLessonAverageRating(input.lessonId);
        return { ratings, stats };
      }),

    // الحصول على تقييم المستخدم لدرس
    getMyRating: protectedProcedure
      .input(z.object({ lessonId: z.number() }))
      .query(async ({ ctx, input }) => {
        const { getUserLessonRating } = await import("./db");
        return await getUserLessonRating(input.lessonId, ctx.user.id);
      }),
  }),

  // المسارات التعليمية
  learningPaths: router({
    // إنشاء مسار تعليمي
    create: protectedProcedure
      .input(
        z.object({
          title: z.string(),
          description: z.string().optional(),
          contentTermVisibility: z.enum(["all", "first", "second"]).default("all"),
          grade: z.string().optional(),
          classId: z.number().optional(),
          isVisible: z.boolean().default(true),
          category: z.enum(["drawing", "decoration", "colors", "texture"]),
          imageUrl: z.string().optional(),
          order: z.number().default(0),
        })
      )
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "teacher" && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN" });
        }

        const termVisibility = normalizeFixedTermVisibility(input.contentTermVisibility);
        const { contentTermVisibility, ...pathPayload } = input;
        const { createLearningPath } = await import("./db");
        const pathId = await createLearningPath({
          ...pathPayload,
          termLabelRaw: fixedTermLabelFromVisibility(termVisibility),
          termId: null,
          contentScope: ctx.user.role === "admin" ? "global" : "teacher",
          ownerTeacherId: ctx.user.role === "admin" ? null : ctx.user.id,
          createdByUserId: ctx.user.id,
          teacherId: ctx.user.id,
        });

        return { id: pathId };
      }),

    // الحصول على جميع المسارات
    getAll: publicProcedure.query(async () => {
      const { getLearningPaths } = await import("./db");
      return await getLearningPaths();
    }),

    // الحصول على مسارات المعلم
    getMyPaths: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role !== "teacher" && ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      const legacyPathSelect = {
        id: learningPaths.id,
        title: learningPaths.title,
        description: learningPaths.description,
        grade: learningPaths.grade,
        termId: learningPaths.termId,
        termLabelRaw: learningPaths.termLabelRaw,
        classId: learningPaths.classId,
        isVisible: learningPaths.isVisible,
        category: learningPaths.category,
        imageUrl: learningPaths.imageUrl,
        order: learningPaths.order,
        teacherId: learningPaths.teacherId,
        createdAt: learningPaths.createdAt,
        updatedAt: learningPaths.updatedAt,
      };

      const database = await getDb();
      if (!database) {
        const { getLearningPaths } = await import("./db");
        return await getLearningPaths(ctx.user.id);
      }

      if (ctx.user.role === "admin") {
        return await database
          .select(legacyPathSelect)
          .from(learningPaths)
          .orderBy(learningPaths.order);
      }

      let ownedPaths: Array<(typeof legacyPathSelect)> | any[] = [];
      try {
        ownedPaths = await database
          .select(legacyPathSelect)
          .from(learningPaths)
          .where(
            and(
              or(
                and(
                  or(eq(learningPaths.contentScope, "teacher"), eq(learningPaths.contentScope, "teacher_override")),
                  or(eq(learningPaths.ownerTeacherId, ctx.user.id), eq(learningPaths.teacherId, ctx.user.id))
                ),
                eq(learningPaths.teacherId, ctx.user.id)
              ),
              or(eq(learningPaths.isVisible, true), isNull(learningPaths.isVisible))
            )
          )
          .orderBy(learningPaths.order);
      } catch (error) {
        if (!isLegacyScopeColumnError(error)) throw error;
        return await database
          .select(legacyPathSelect)
          .from(learningPaths)
          .where(and(eq(learningPaths.teacherId, ctx.user.id), or(eq(learningPaths.isVisible, true), isNull(learningPaths.isVisible))))
          .orderBy(learningPaths.order);
      }

      const classRows = await database
        .select({ grade: classes.grade })
        .from(classes)
        .where(eq(classes.teacherId, ctx.user.id));
      const grades = Array.from(new Set(classRows.map((row) => String(row.grade || "").trim()).filter(Boolean)));
      const canonicalGradeIds = await resolveCanonicalGradeIds(database, classRows.map((row) => row.grade));
      if (grades.length === 0) return ownedPaths;

      const centralPathGradeConditions: SQL<unknown>[] = [
        canonicalGradeIds.length > 0 ? inArray(learningPaths.gradeId, canonicalGradeIds) : undefined,
        inArray(learningPaths.grade, grades),
        eq(learningPaths.grade, ""),
        isNull(learningPaths.grade),
      ].filter(isDefinedSql);

      const centralPaths = await database
        .select(legacyPathSelect)
        .from(learningPaths)
        .where(
          and(
            or(eq(learningPaths.contentScope, "global"), and(isNull(learningPaths.ownerTeacherId), isNull(learningPaths.classId))),
            or(eq(learningPaths.isVisible, true), isNull(learningPaths.isVisible)),
            or(...centralPathGradeConditions)
          )
        )
        .orderBy(learningPaths.order);

      const merged = new Map<number, (typeof ownedPaths)[number]>();
      for (const pathItem of ownedPaths) {
        merged.set(Number(pathItem.id), pathItem);
      }
      for (const pathItem of centralPaths) {
        merged.set(Number(pathItem.id), pathItem as (typeof ownedPaths)[number]);
      }

      return Array.from(merged.values());
    }),

    getForStudent: protectedProcedure.query(async ({ ctx }) => {
      const database = await getDb();
      if (!database) return [];

      const studentClassRows = await database
        .select({
          classId: classStudents.classId,
          grade: classes.grade,
          teacherId: classes.teacherId,
          studentContentTermVisibility: classes.studentContentTermVisibility,
        })
        .from(classStudents)
        .innerJoin(classes, eq(classStudents.classId, classes.id))
        .where(eq(classStudents.studentId, ctx.user.id));

      if (studentClassRows.length === 0) return [];

      const classIds = Array.from(new Set(studentClassRows.map((row) => row.classId)));
      const classPolicyById = new Map<number, FixedTermVisibility>();
      for (const row of studentClassRows) {
        classPolicyById.set(Number(row.classId), normalizeFixedTermVisibility(row.studentContentTermVisibility));
      }
      const classPolicies = Array.from(classPolicyById.values());
      const teacherIds = Array.from(new Set(studentClassRows.map((row) => row.teacherId)));
      const normalizedStudentGrades = new Set(
        studentClassRows
          .map((row) => normalizeGradeKey(String(row.grade || "")))
          .filter(Boolean)
      );
      const canonicalStudentGradeIds = await resolveCanonicalGradeIds(
        database,
        studentClassRows.map((row) => row.grade),
      );

      const visibilityConditions: SQL<unknown>[] = [
        inArray(learningPaths.classId, classIds),
        isNull(learningPaths.classId),
      ].filter(isDefinedSql);

      const result = await database
        .select()
        .from(learningPaths)
        .where(
          and(
            or(eq(learningPaths.isVisible, true), isNull(learningPaths.isVisible)),
            or(...visibilityConditions)
          )
        )
        .orderBy(learningPaths.order);

      return result.filter((pathItem) => {
        const contentTerm = extractFixedTermFromContent({
          termId: pathItem.termId,
          termLabelRaw: pathItem.termLabelRaw,
        });
        if (pathItem.classId != null) {
          if (!classIds.includes(Number(pathItem.classId))) return false;
          const classPolicy = classPolicyById.get(Number(pathItem.classId));
          if (!classPolicy) return false;
          return isContentTermAllowedByClassPolicy({ classPolicy, contentTerm });
        }

        if (!isContentTermAllowedByStudentClasses({ classPolicies, contentTerm })) {
          return false;
        }

        const gradeMatches = matchesGradeCanonicalFirst({
          itemGradeId: pathItem.gradeId,
          itemGradeRaw: pathItem.grade,
          canonicalGradeIds: canonicalStudentGradeIds,
          normalizedLegacyGrades: normalizedStudentGrades,
        });
        const isGlobal = pathItem.contentScope === "global" || (pathItem.ownerTeacherId == null && pathItem.classId == null);
        if (isGlobal) {
          return gradeMatches;
        }

        const ownerId = Number(pathItem.ownerTeacherId || pathItem.teacherId || 0);
        const belongsToMyTeacher = ownerId > 0 && teacherIds.includes(ownerId);
        return belongsToMyTeacher && gradeMatches;
      });
    }),

    // الحصول على مسار محدد
    getById: publicProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        const { getLearningPath } = await import("./db");
        return await getLearningPath(input.id);
      }),

    getByIdForStudent: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ ctx, input }) => {
        if (ctx.user.role !== "student" && ctx.user.role !== "user") {
          throw new TRPCError({ code: "FORBIDDEN" });
        }

        const database = await getDb();
        if (!database) return null;

        const pathRows = await database
          .select()
          .from(learningPaths)
          .where(and(eq(learningPaths.id, input.id), or(eq(learningPaths.isVisible, true), isNull(learningPaths.isVisible))))
          .limit(1);
        const pathItem = pathRows[0];
        if (!pathItem) return null;

        const studentClassRows = await database
          .select({
            classId: classStudents.classId,
            grade: classes.grade,
            teacherId: classes.teacherId,
            studentContentTermVisibility: classes.studentContentTermVisibility,
          })
          .from(classStudents)
          .innerJoin(classes, eq(classStudents.classId, classes.id))
          .where(eq(classStudents.studentId, ctx.user.id));
        if (studentClassRows.length === 0) return null;

        const classIds = Array.from(new Set(studentClassRows.map((row) => Number(row.classId))));
        const classPolicyById = new Map<number, FixedTermVisibility>();
        for (const row of studentClassRows) {
          classPolicyById.set(Number(row.classId), normalizeFixedTermVisibility(row.studentContentTermVisibility));
        }
        const classPolicies = Array.from(classPolicyById.values());
        const contentTerm = extractFixedTermFromContent({ termId: pathItem.termId, termLabelRaw: pathItem.termLabelRaw });

        if (pathItem.classId != null) {
          if (!classIds.includes(Number(pathItem.classId))) return null;
          const classPolicy = classPolicyById.get(Number(pathItem.classId));
          if (!classPolicy) return null;
          if (!isContentTermAllowedByClassPolicy({ classPolicy, contentTerm })) return null;
          return pathItem;
        }

        if (!isContentTermAllowedByStudentClasses({ classPolicies, contentTerm })) return null;

        const teacherIds = Array.from(new Set(studentClassRows.map((row) => Number(row.teacherId))));
        const normalizedStudentGrades = new Set(
          studentClassRows.map((row) => normalizeGradeKey(String(row.grade || ""))).filter(Boolean)
        );
        const canonicalStudentGradeIds = await resolveCanonicalGradeIds(
          database,
          studentClassRows.map((row) => row.grade),
        );
        const gradeMatches = matchesGradeCanonicalFirst({
          itemGradeId: pathItem.gradeId,
          itemGradeRaw: pathItem.grade,
          canonicalGradeIds: canonicalStudentGradeIds,
          normalizedLegacyGrades: normalizedStudentGrades,
        });

        const isGlobal = pathItem.contentScope === "global" || (pathItem.ownerTeacherId == null && pathItem.classId == null);
        if (isGlobal) {
          return gradeMatches ? pathItem : null;
        }

        const ownerId = Number(pathItem.ownerTeacherId || pathItem.teacherId || 0);
        const belongsToMyTeacher = ownerId > 0 && teacherIds.includes(ownerId);
        return belongsToMyTeacher && gradeMatches ? pathItem : null;
      }),

    // تحديث مسار
    update: protectedProcedure
      .input(
        z.object({
          id: z.number(),
          title: z.string().optional(),
          description: z.string().optional(),
          contentTermVisibility: z.enum(["all", "first", "second"]).optional(),
          grade: z.string().optional(),
          classId: z.number().nullable().optional(),
          isVisible: z.boolean().optional(),
          category: z.enum(["drawing", "decoration", "colors", "texture"]).optional(),
          imageUrl: z.string().optional(),
          order: z.number().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "teacher" && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN" });
        }

        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const { id, contentTermVisibility, ...data } = input;
        const currentRows = await database
          .select()
          .from(learningPaths)
          .where(eq(learningPaths.id, id))
          .limit(1);
        const current = currentRows[0];
        if (!current) {
          throw new TRPCError({ code: "NOT_FOUND", message: "المسار غير موجود" });
        }

        const nextPathTerm = contentTermVisibility
          ? normalizeFixedTermVisibility(contentTermVisibility)
          : extractFixedTermFromContent({
              termId: current.termId,
              termLabelRaw: current.termLabelRaw,
            });

        const linkedLessonRows = await database
          .select({ lessonId: pathLessons.lessonId })
          .from(pathLessons)
          .where(eq(pathLessons.pathId, id));
        await assertPathTermConsistency({
          database,
          pathTerm: nextPathTerm,
          lessonIds: linkedLessonRows.map((row) => Number(row.lessonId)).filter((lessonId) => lessonId > 0),
        });

        const normalizedData = {
          ...data,
          ...(contentTermVisibility
            ? {
                termLabelRaw: fixedTermLabelFromVisibility(nextPathTerm),
                termId: null,
              }
            : {}),
        };

        const ownerId = Number(current.ownerTeacherId || current.teacherId || 0);
        const isGlobal = current.contentScope === "global" || (current.ownerTeacherId == null && current.classId == null);
        const isOwnedByTeacher = ownerId > 0 && ownerId === Number(ctx.user.id);

        let targetPathId = id;

        if (ctx.user.role !== "admin" && isGlobal && !isOwnedByTeacher) {
          const existingOverride = await database
            .select({ id: learningPaths.id })
            .from(learningPaths)
            .where(
              and(
                eq(learningPaths.sourcePathId, id),
                eq(learningPaths.contentScope, "teacher_override"),
                eq(learningPaths.ownerTeacherId, ctx.user.id)
              )
            )
            .limit(1);

          if (existingOverride[0]?.id) {
            targetPathId = Number(existingOverride[0].id);
            await db.updateLearningPath(targetPathId, {
              ...normalizedData,
              contentScope: "teacher_override",
              sourcePathId: id,
              ownerTeacherId: ctx.user.id,
              createdByUserId: ctx.user.id,
            });
          } else {
            const targetInsertId = await db.createLearningPath({
              title: Object.prototype.hasOwnProperty.call(normalizedData, "title") ? normalizedData.title || current.title : current.title,
              description: Object.prototype.hasOwnProperty.call(normalizedData, "description") ? normalizedData.description || current.description || "" : current.description || "",
              grade: Object.prototype.hasOwnProperty.call(normalizedData, "grade") ? normalizedData.grade || current.grade || "" : current.grade || "",
              classId: Object.prototype.hasOwnProperty.call(normalizedData, "classId") ? normalizedData.classId ?? null : current.classId,
              isVisible: Object.prototype.hasOwnProperty.call(normalizedData, "isVisible") ? normalizedData.isVisible ?? (current.isVisible ?? true) : (current.isVisible ?? true),
              category: Object.prototype.hasOwnProperty.call(normalizedData, "category") && normalizedData.category ? normalizedData.category : current.category,
              imageUrl: Object.prototype.hasOwnProperty.call(normalizedData, "imageUrl") ? normalizedData.imageUrl || "" : current.imageUrl || "",
              order: Object.prototype.hasOwnProperty.call(normalizedData, "order") ? normalizedData.order ?? (current.order || 0) : (current.order || 0),
              teacherId: ctx.user.id,
              contentScope: "teacher_override",
              ownerTeacherId: ctx.user.id,
              createdByUserId: ctx.user.id,
              sourcePathId: id,
              importJobId: current.importJobId,
              stageId: current.stageId,
              gradeId: current.gradeId,
              termId: contentTermVisibility ? null : current.termId,
              subjectId: current.subjectId,
              gradeLabelRaw: current.gradeLabelRaw,
              termLabelRaw: contentTermVisibility ? fixedTermLabelFromVisibility(nextPathTerm) : current.termLabelRaw,
              subjectLabelRaw: current.subjectLabelRaw,
            } as any);

            targetPathId = Number(targetInsertId || 0);
            if (!targetPathId) {
              throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "تعذر إنشاء نسخة override للمسار" });
            }

            const sourceLinks = await database
              .select({ lessonId: pathLessons.lessonId, order: pathLessons.order })
              .from(pathLessons)
              .where(eq(pathLessons.pathId, id));

            for (const link of sourceLinks) {
              await database.insert(pathLessons).values({
                pathId: targetPathId,
                lessonId: Number(link.lessonId),
                order: Number(link.order || 0),
              });
            }
          }
        } else {
          if (ctx.user.role !== "admin" && !isOwnedByTeacher) {
            throw new TRPCError({ code: "FORBIDDEN", message: "لا تملك صلاحية تعديل هذا المسار" });
          }

          await db.updateLearningPath(id, normalizedData as any);
        }

        return { success: true, pathId: targetPathId, isOverride: targetPathId !== id };
      }),

    // حذف مسار
    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "teacher" && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN" });
        }

        const { deleteLearningPath } = await import("./db");
        await deleteLearningPath(input.id);

        return { success: true };
      }),

    // إضافة درس للمسار
    addLesson: protectedProcedure
      .input(
        z.object({
          pathId: z.number(),
          lessonId: z.number(),
          order: z.number(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "teacher" && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN" });
        }

        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const pathRows = await database
          .select({ id: learningPaths.id, termId: learningPaths.termId, termLabelRaw: learningPaths.termLabelRaw })
          .from(learningPaths)
          .where(eq(learningPaths.id, input.pathId))
          .limit(1);
        const pathRow = pathRows[0];
        if (!pathRow) {
          throw new TRPCError({ code: "NOT_FOUND", message: "المسار غير موجود" });
        }

        const existingLessonRows = await database
          .select({ lessonId: pathLessons.lessonId })
          .from(pathLessons)
          .where(eq(pathLessons.pathId, input.pathId));
        const linkedLessonIds = Array.from(
          new Set(
            [...existingLessonRows.map((row) => Number(row.lessonId)), Number(input.lessonId)].filter((lessonId) => lessonId > 0)
          )
        );

        await assertPathTermConsistency({
          database,
          pathTerm: extractFixedTermFromContent({ termId: pathRow.termId, termLabelRaw: pathRow.termLabelRaw }),
          lessonIds: linkedLessonIds,
        });

        const { addLessonToPath } = await import("./db");
        await addLessonToPath(input.pathId, input.lessonId, input.order);

        return { success: true };
      }),

    // الحصول على دروس المسار
    getLessons: publicProcedure
      .input(z.object({ pathId: z.number() }))
      .query(async ({ input }) => {
        const { getPathLessons } = await import("./db");
        return await getPathLessons(input.pathId);
      }),

    getLessonsForStudent: protectedProcedure
      .input(z.object({ pathId: z.number() }))
      .query(async ({ ctx, input }) => {
        if (ctx.user.role !== "student" && ctx.user.role !== "user") {
          throw new TRPCError({ code: "FORBIDDEN" });
        }

        const database = await getDb();
        if (!database) return [];

        const { getPathLessons } = await import("./db");
        const rows = await getPathLessons(input.pathId);
        const visible: any[] = [];
        for (const row of rows as any[]) {
          const lesson = row?.lesson;
          if (!lesson) continue;
          const hasAccess = await canUserAccessLessonForPlayback({
            database,
            user: { id: Number(ctx.user.id), role: String(ctx.user.role || "") },
            lesson: {
              id: Number(lesson.id),
              classId: lesson.classId == null ? null : Number(lesson.classId),
              isVisible: lesson.isVisible,
              contentScope: lesson.contentScope == null ? null : String(lesson.contentScope),
              ownerTeacherId: lesson.ownerTeacherId == null ? null : Number(lesson.ownerTeacherId),
              teacherId: lesson.teacherId == null ? null : Number(lesson.teacherId),
              grade: lesson.grade == null ? null : String(lesson.grade),
              gradeId: lesson.gradeId == null ? null : Number(lesson.gradeId),
              termId: lesson.termId == null ? null : Number(lesson.termId),
              termLabelRaw: lesson.termLabelRaw == null ? null : String(lesson.termLabelRaw),
            },
          });
          if (hasAccess) {
            visible.push(row);
          }
        }

        return visible;
      }),

    // حذف درس من المسار
    removeLesson: protectedProcedure
      .input(
        z.object({
          pathId: z.number(),
          lessonId: z.number(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "teacher" && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN" });
        }

        const { removeLessonFromPath } = await import("./db");
        await removeLessonFromPath(input.pathId, input.lessonId);

        return { success: true };
      }),

    // تحديد درس كمكتمل
    markLessonCompleted: protectedProcedure
      .input(
        z.object({
          pathId: z.number(),
          lessonId: z.number(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { markLessonCompleted, checkAndAwardBadges } = await import("./db");
        await markLessonCompleted(ctx.user.id, input.pathId, input.lessonId);
        
        // التحقق من منح الشارات عند إكمال المسار
        await checkAndAwardBadges(ctx.user.id, input.pathId);

        // التحقق من إكمال المسار وإصدار شهادة
        const database = await getDb();
        if (database) {
          // الحصول على معلومات المسار
          const path = await database.select()
            .from(learningPaths)
            .where(eq(learningPaths.id, input.pathId))
            .limit(1);

          if (path[0]) {
            const eligibility = await canStudentReceivePathCertificate(database, ctx.user.id, input.pathId);
            if (eligibility.eligible) {
              const existingCert = await database
                .select({ id: certificates.id })
                .from(certificates)
                .where(and(eq(certificates.studentId, ctx.user.id), eq(certificates.pathId, input.pathId), eq(certificates.issueType, "auto")))
                .limit(1);

              if (!existingCert[0]) {
                const certificateNumber = `CERT-A-${Date.now()}-${ctx.user.id}`;
                await database.insert(certificates).values({
                  studentId: ctx.user.id,
                  pathId: input.pathId,
                  certificateNumber,
                  studentName: ctx.user.name || "طالب",
                  title: `إتمام مسار ${path[0].title}`,
                  description: `أكمل بنجاح جميع دروس مسار "${path[0].title}" واكتسب المهارات المطلوبة.`,
                  issueType: "auto",
                  status: "earned",
                  issuedByUserId: path[0].teacherId,
                });

                await database.insert(notifications).values({
                  studentId: ctx.user.id,
                  title: "🎉 مبروك! حصلت على شهادة جديدة",
                  message: `تم إصدار شهادة إتمام مسار "${path[0].title}". يمكنك مشاهدتها في صفحة الشهادات.`,
                  type: "achievement",
                });
              }
            }
          }
        }

        return { success: true };
      }),

    // الحصول على تقدم الطالب
    getProgress: protectedProcedure
      .input(z.object({ pathId: z.number() }))
      .query(async ({ ctx, input }) => {
        const { getPathProgress } = await import("./db");
        return await getPathProgress(ctx.user.id, input.pathId);
      }),

    // الحصول على تفاصيل تقدم دروس المسار (لكل درس)
    getLessonProgress: protectedProcedure
      .input(z.object({ pathId: z.number() }))
      .query(async ({ ctx, input }) => {
        const { getStudentProgress } = await import("./db");
        return await getStudentProgress(ctx.user.id, input.pathId);
      }),
  }),

  // الحضور
  attendance: router({
    // الحصول على سجل الحضور لتاريخ محدد
    getByDate: protectedProcedure
      .input(z.object({ 
        classId: z.number(),
        date: z.string() 
      }))
      .query(async ({ input }) => {
        const { getAttendanceByDate } = await import("./db");
        return await getAttendanceByDate(input.classId, input.date);
      }),

    // تسجيل الحضور
    mark: protectedProcedure
      .input(z.object({
        classId: z.number(),
        studentId: z.number(),
        date: z.string(),
        status: z.enum(["present", "absent", "late"]),
      }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "teacher" && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN" });
        }

        const { markAttendance } = await import("./db");
        await markAttendance(input.classId, input.studentId, input.date, input.status);
        return { success: true };
      }),
  }),

  // الدرجات
  grades: router({
    // الحصول على درجات فصل معين
    getByClass: protectedProcedure
      .input(z.object({ classId: z.number() }))
      .query(async ({ input }) => {
        const database = await getDb();
        if (!database) return [];
        return database.select().from(studentGrades).where(eq(studentGrades.classId, input.classId));
      }),

    // حفظ درجات طالب
    save: protectedProcedure
      .input(
        z.object({
          classId: z.number(),
          studentId: z.number(),
          participationGrade: z.number().optional(),
          toolsGrade: z.number().optional(),
          behaviorGrade: z.number().optional(),
          examGrade: z.number().optional(),
          artworkGrade: z.number().optional(),
          finalGrade: z.number(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "teacher" && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN" });
        }

        const database = await getDb();
        if (!database) throw new Error("Database not available");

        const settingsRows = await database
          .select()
          .from(gradeSettings)
          .where(eq(gradeSettings.teacherId, ctx.user.id))
          .limit(1);

        const effectiveSettings = normalizeGradeSettings(settingsRows[0] || DEFAULT_GRADE_SETTINGS);
        const validation = validateStudentGradesAgainstSettings(effectiveSettings, {
          participationGrade: input.participationGrade,
          toolsGrade: input.toolsGrade,
          behaviorGrade: input.behaviorGrade,
          examGrade: input.examGrade,
          artworkGrade: input.artworkGrade,
        });

        if (!validation.isValid) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: validation.errors[0] || "بيانات الدرجات غير صالحة",
          });
        }

        // التحقق من وجود سجل سابق
        const existing = await database
          .select()
          .from(studentGrades)
          .where(
            and(
              eq(studentGrades.classId, input.classId),
              eq(studentGrades.studentId, input.studentId)
            )
          )
          .limit(1);

        const gradeData = {
          classId: input.classId,
          studentId: input.studentId,
          participationGrade: input.participationGrade || 0,
          toolsGrade: input.toolsGrade || 0,
          behaviorGrade: input.behaviorGrade || 0,
          examGrade: input.examGrade || 0,
          artworkGrade: input.artworkGrade || 0,
          finalGrade: validation.finalGrade,
        };

        if (existing.length > 0) {
          // تحديث السجل الموجود
          await database
            .update(studentGrades)
            .set(gradeData)
            .where(eq(studentGrades.id, existing[0].id));
        } else {
          // إنشاء سجل جديد
          await database.insert(studentGrades).values(gradeData);
        }

        return { success: true };
      }),

    // الحصول على إعدادات الدرجات للمعلم
    getSettings: protectedProcedure.query(async ({ ctx }) => {
      const database = await getDb();
      if (!database) return null;

      const result = await database.select()
        .from(gradeSettings)
        .where(eq(gradeSettings.teacherId, ctx.user.id))
        .limit(1);

      return result[0] || null;
    }),

    // حفظ إعدادات الدرجات
    saveSettings: protectedProcedure
      .input(z.object({
        grade1Name: z.string(),
        grade1Value: z.number(),
        grade2Name: z.string(),
        grade2Value: z.number(),
        grade3Name: z.string(),
        grade3Value: z.number(),
        grade4Name: z.string(),
        grade4Value: z.number(),
        grade5Name: z.string(),
        grade5Value: z.number(),
      }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "teacher" && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN" });
        }

        const database = await getDb();
        if (!database) throw new Error("Database not available");

        const normalizedSettings = normalizeGradeSettings(input);
        if (hasGradeSettingsOverflow(normalizedSettings)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "مجموع توزيع الدرجات لا يجوز أن يتجاوز 100",
          });
        }

        // التحقق من وجود إعدادات سابقة
        const existing = await database.select()
          .from(gradeSettings)
          .where(eq(gradeSettings.teacherId, ctx.user.id))
          .limit(1);

        if (existing.length > 0) {
          // تحديث الإعدادات
          await database.update(gradeSettings)
            .set(normalizedSettings)
            .where(eq(gradeSettings.id, existing[0].id));
        } else {
          // إنشاء إعدادات جديدة
          await database.insert(gradeSettings).values({
            teacherId: ctx.user.id,
            ...normalizedSettings,
          });
        }

        return { success: true };
      }),
  }),

  // إحصائيات المعلم
  teacher: router({
    // الحصول على إحصائيات المعلم
    getStats: protectedProcedure.query(async ({ ctx }) => {
      const database = await getDb();
      if (!database) return {
        classesCount: 0,
        studentsCount: 0,
        artworksCount: 0,
        challengesCount: 0,
      };

      // عدد الفصول
      const [classesResult] = await database
        .select({ count: sql<number>`count(*)` })
        .from(classes)
        .where(eq(classes.teacherId, ctx.user.id));

      // عدد الطلاب في جميع فصول المعلم
      const teacherClasses = await database
        .select({ id: classes.id })
        .from(classes)
        .where(eq(classes.teacherId, ctx.user.id));
      
      const classIds = teacherClasses.map(c => c.id);
      let studentsCount = 0;
      
      if (classIds.length > 0) {
        const [studentsResult] = await database
          .select({ count: sql<number>`count(DISTINCT ${classStudents.studentId})` })
          .from(classStudents)
          .where(sql`${classStudents.classId} IN (${sql.join(classIds.map(id => sql`${id}`), sql`, `)})`);  
        studentsCount = Number(studentsResult.count) || 0;
      }

      // عدد الأعمال الفنية
      let artworksCount = 0;
      if (classIds.length > 0) {
        const [artworksResult] = await database
          .select({ count: sql<number>`count(*)` })
          .from(artworks)
          .where(sql`${artworks.classId} IN (${sql.join(classIds.map(id => sql`${id}`), sql`, `)})`);  
        artworksCount = Number(artworksResult.count) || 0;
      }

      // عدد التحديات
      const [challengesResult] = await database
        .select({ count: sql<number>`count(*)` })
        .from(challenges)
        .where(eq(challenges.teacherId, ctx.user.id));

      return {
        classesCount: Number(classesResult.count) || 0,
        studentsCount,
        artworksCount,
        challengesCount: Number(challengesResult.count) || 0,
      };
    }),

    aiArtAgent: router({
      getStatus: protectedProcedure.query(({ ctx }) => {
        if (ctx.user.role !== "teacher" && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN" });
        }

        const status = getArtAiAgentRuntimeStatus();

        return {
          enabled: status.featureEnabled,
          hasAiKey: status.providerConfigured,
          featureEnabled: status.featureEnabled,
          providerConfigured: status.providerConfigured,
          mode: status.mode,
          provider: status.provider,
          lastErrorType: status.lastErrorType,
        };
      }),

      getArtworkOptions: protectedProcedure.query(async ({ ctx }) => {
        if (ctx.user.role !== "teacher" && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN" });
        }

        const database = await getDb();
        if (!database) return [];

        const whereClause =
          ctx.user.role === "admin" ? undefined : eq(classes.teacherId, ctx.user.id);

        const rows = await database
          .select({
            id: artworks.id,
            title: artworks.title,
            description: artworks.description,
            imageUrl: artworks.imageUrl,
            imageKey: artworks.imageKey,
            studentId: artworks.studentId,
            studentName: users.name,
            classId: classes.id,
            className: classes.name,
            gradeName: classes.grade,
            createdAt: artworks.createdAt,
          })
          .from(artworks)
          .innerJoin(classes, eq(artworks.classId, classes.id))
          .leftJoin(users, eq(artworks.studentId, users.id))
          .where(whereClause)
          .orderBy(desc(artworks.createdAt))
          .limit(30);

        return Promise.all(
          rows.map(async (row: any) => ({
            ...row,
            imageUrl: await resolveArtworkImageUrl(row.imageUrl, row.imageKey),
          })),
        );
      }),

      analyzeArtwork: protectedProcedure
        .input(
          z.object({
            artworkId: z.number(),
            teacherNotes: z.string().max(2000).optional(),
          }),
        )
        .mutation(async ({ ctx, input }) => {
          if (ctx.user.role !== "teacher" && ctx.user.role !== "admin") {
            throw new TRPCError({ code: "FORBIDDEN" });
          }

          if (!ENV.aiArtAgentEnabled) {
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message: "ميزة الوكيل الذكي غير مفعلة. أضف AI_ART_AGENT_ENABLED=true لتفعيلها.",
            });
          }

          const database = await getDb();
          if (!database) {
            throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
          }

          const rows = await database
            .select({
              id: artworks.id,
              title: artworks.title,
              description: artworks.description,
              imageUrl: artworks.imageUrl,
              imageKey: artworks.imageKey,
              studentId: artworks.studentId,
              studentName: users.name,
              classId: classes.id,
              className: classes.name,
              gradeName: classes.grade,
              teacherId: classes.teacherId,
            })
            .from(artworks)
            .innerJoin(classes, eq(artworks.classId, classes.id))
            .leftJoin(users, eq(artworks.studentId, users.id))
            .where(eq(artworks.id, input.artworkId))
            .limit(1);

          const artwork = rows[0];
          if (!artwork) {
            throw new TRPCError({ code: "NOT_FOUND", message: "العمل الفني غير موجود" });
          }

          const isOwnerTeacher = ctx.user.role === "teacher" && artwork.teacherId === ctx.user.id;
          if (ctx.user.role !== "admin" && !isOwnerTeacher) {
            throw new TRPCError({ code: "FORBIDDEN", message: "لا تملك صلاحية تحليل هذا العمل الفني" });
          }

          const resolvedImageUrl = await resolveArtworkImageUrl(artwork.imageUrl, artwork.imageKey);
          const analysis = await analyzeStudentArtwork({
            artworkId: artwork.id,
            title: artwork.title,
            description: artwork.description,
            studentName: artwork.studentName,
            gradeName: artwork.gradeName,
            className: artwork.className,
            imageUrl: resolvedImageUrl,
            teacherNotes: input.teacherNotes,
          });

          let saved = false;
          let analysisId: number | null = null;

          try {
            const [insertResult] = await database.insert(aiArtworkAnalyses).values({
              artworkId: artwork.id,
              teacherId: ctx.user.role === "admin" ? artwork.teacherId : ctx.user.id,
              studentId: artwork.studentId,
              resultJson: JSON.stringify(analysis.result),
              provider: analysis.provider,
              promptVersion: analysis.promptVersion,
            });

            saved = true;
            analysisId = Number((insertResult as any)?.insertId || 0) || null;
          } catch {
            saved = false;
          }

          return {
            success: true,
            saved,
            analysisId,
            artwork: {
              id: artwork.id,
              title: artwork.title,
              studentName: artwork.studentName || "طالب",
              className: artwork.className,
              gradeName: artwork.gradeName,
              imageUrl: resolvedImageUrl,
            },
            ...analysis,
          };
        }),

      getRecentAnalyses: protectedProcedure.query(async ({ ctx }) => {
        if (ctx.user.role !== "teacher" && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN" });
        }

        const database = await getDb();
        if (!database) return [];

        try {
          const whereClause =
            ctx.user.role === "admin" ? undefined : eq(aiArtworkAnalyses.teacherId, ctx.user.id);

          const rows = await database
            .select({
              id: aiArtworkAnalyses.id,
              artworkId: aiArtworkAnalyses.artworkId,
              resultJson: aiArtworkAnalyses.resultJson,
              provider: aiArtworkAnalyses.provider,
              promptVersion: aiArtworkAnalyses.promptVersion,
              createdAt: aiArtworkAnalyses.createdAt,
              artworkTitle: artworks.title,
              studentName: users.name,
            })
            .from(aiArtworkAnalyses)
            .leftJoin(artworks, eq(aiArtworkAnalyses.artworkId, artworks.id))
            .leftJoin(users, eq(aiArtworkAnalyses.studentId, users.id))
            .where(whereClause)
            .orderBy(desc(aiArtworkAnalyses.createdAt))
            .limit(10);

          return rows.map((row) => {
            let result: unknown = null;
            try {
              result = JSON.parse(row.resultJson || "null");
            } catch {
              result = null;
            }

            return {
              ...row,
              result,
              resultJson: undefined,
            };
          });
        } catch {
          return [];
        }
      }),

      updateAnalysisResult: protectedProcedure
        .input(
          z.object({
            analysisId: z.number().int().positive(),
            result: z.object({
              analysisSteps: z.array(z.string()).optional(),
              summary: z.string(),
              strengths: z.array(z.string()),
              improvements: z.array(z.string()),
              completionStatus: z.enum(["مكتمل", "شبه مكتمل", "غير مكتمل"]),
              artisticQualityLevel: z.enum(["ممتاز", "جيد جدًا", "جيد", "يحتاج دعم"]),
              performanceLevel: z.enum(["يحتاج دعمًا", "في طور التحسن", "متمكن", "متقدم"]),
              reviewAlert: z.string().optional(),
              readyFeedback: z.string(),
              suggestedActivity: z.string(),
              studentMessage: z.string(),
              teacherNotes: z.string(),
            }),
          }),
        )
        .mutation(async ({ ctx, input }) => {
          if (ctx.user.role !== "teacher" && ctx.user.role !== "admin") {
            throw new TRPCError({ code: "FORBIDDEN" });
          }

          const database = await getDb();
          if (!database) {
            throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
          }

          const rows = await database
            .select({
              id: aiArtworkAnalyses.id,
              teacherId: aiArtworkAnalyses.teacherId,
            })
            .from(aiArtworkAnalyses)
            .where(eq(aiArtworkAnalyses.id, input.analysisId))
            .limit(1);

          const analysis = rows[0];
          if (!analysis) {
            throw new TRPCError({ code: "NOT_FOUND", message: "التحليل غير موجود" });
          }

          if (ctx.user.role !== "admin" && analysis.teacherId !== ctx.user.id) {
            throw new TRPCError({ code: "FORBIDDEN", message: "لا تملك صلاحية تعديل هذا التحليل" });
          }

          await database
            .update(aiArtworkAnalyses)
            .set({
              resultJson: JSON.stringify(input.result),
              updatedAt: new Date(),
            })
            .where(eq(aiArtworkAnalyses.id, input.analysisId));

          return {
            success: true,
            result: input.result,
          };
        }),
    }),
  }),

  subscriptions: router({
    getMyStatus: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role !== "teacher" && ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      await ensureDefaultSubscriptionPlans();
      const status = await getTeacherSubscriptionStatus(ctx.user.id);
      const entitlements = await getTeacherEntitlements(ctx.user.id);
      const studentsCovered = await countTeacherBeneficiaryStudents(ctx.user.id);

      return {
        ...status,
        entitlements,
        studentsCovered,
        expiresInDays: status.subscription?.currentPeriodEnd
          ? Math.ceil(
              (new Date(status.subscription.currentPeriodEnd).getTime() - Date.now()) /
                (1000 * 60 * 60 * 24),
            )
          : null,
      };
    }),

    submitTeacherRequest: protectedProcedure
      .input(
        z.object({
          requestType: z.enum(["activation", "renewal", "details"]),
          note: z.string().max(2000).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "teacher" && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN" });
        }

        await ensureDefaultSubscriptionPlans();
        const database = await getDb();
        if (!database) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        }

        const status = await getTeacherSubscriptionStatus(ctx.user.id);
        let latestSubscriptionId = Number(status.subscription?.id || 0);

        if (!latestSubscriptionId) {
          const preferredPlanRows = await database
            .select({ id: subscriptionPlans.id })
            .from(subscriptionPlans)
            .where(eq(subscriptionPlans.code, "free"))
            .limit(1);

          const fallbackPlanRows = await database
            .select({ id: subscriptionPlans.id })
            .from(subscriptionPlans)
            .orderBy(asc(subscriptionPlans.id))
            .limit(1);

          const shellPlanId = Number(preferredPlanRows[0]?.id || fallbackPlanRows[0]?.id || 0);
          if (!shellPlanId) {
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "تعذر إنشاء سجل الطلب بسبب عدم توفر باقات اشتراك.",
            });
          }

          const now = new Date();
          await database.insert(teacherSubscriptions).values({
            teacherId: ctx.user.id,
            planId: shellPlanId,
            status: "canceled",
            source: "manual",
            startsAt: now,
            currentPeriodStart: now,
            currentPeriodEnd: now,
            canceledAt: now,
            notes: REQUEST_ONLY_SUBSCRIPTION_NOTE,
          });

          const createdRows = await database
            .select({ id: teacherSubscriptions.id })
            .from(teacherSubscriptions)
            .where(eq(teacherSubscriptions.teacherId, ctx.user.id))
            .orderBy(desc(teacherSubscriptions.id))
            .limit(1);

          latestSubscriptionId = Number(createdRows[0]?.id || 0);
        }

        if (!latestSubscriptionId) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "تعذر تسجيل طلب الاشتراك حاليًا.",
          });
        }

        const eventType =
          input.requestType === "activation"
            ? "teacher_request_activation"
            : input.requestType === "renewal"
              ? "teacher_request_renewal"
              : "teacher_request_details";

        await logSubscriptionEvent({
          teacherSubscriptionId: latestSubscriptionId,
          eventType,
          payload: {
            actorUserId: ctx.user.id,
            teacherId: ctx.user.id,
            note: input.note || null,
            hasSubscription: Boolean(status.hasSubscription),
            isActive: Boolean(status.isActive),
            status: status.subscription?.status || null,
            periodEnd: status.subscription?.currentPeriodEnd
              ? new Date(status.subscription.currentPeriodEnd).toISOString()
              : null,
          },
        });

        return {
          success: true,
          logged: true,
          message: "تم تسجيل الطلب وإرساله إلى إدارة المنصة.",
        };
      }),

    redeemActivationCode: protectedProcedure
      .input(z.object({ code: z.string().trim().min(3).max(120) }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "teacher" && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN" });
        }

        const result = await redeemSubscriptionActivationCode({
          teacherId: ctx.user.id,
          code: input.code,
        });

        if (!result.success) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "كود التفعيل غير صالح أو منتهي.",
          });
        }

        return {
          success: true,
          message: "تم تفعيل اشتراكك بنجاح، وتم فتح المزايا لك ولطلابك.",
          redeemedCount: result.redeemedCount,
          subscriptionId: result.subscriptionId,
        };
      }),

    studentFeatureAccess: protectedProcedure
      .input(
        z.object({
          featureCode: z.string().min(1),
          ownerTeacherId: z.number().optional(),
        }),
      )
      .query(async ({ ctx, input }) => {
        if (ctx.user.role !== "student" && ctx.user.role !== "user") {
          throw new TRPCError({ code: "FORBIDDEN" });
        }

        const allowed = await canStudentAccessPaidFeature(
          ctx.user.id,
          input.featureCode as (typeof SUBSCRIPTION_FEATURES)[keyof typeof SUBSCRIPTION_FEATURES],
          input.ownerTeacherId,
        );

        if (!allowed) {
          return {
            allowed: false,
            message: "هذه الميزة غير متاحة حاليًا في حساب معلمك.",
          };
        }

        return { allowed: true, message: null };
      }),

    listPlans: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      await ensureDefaultSubscriptionPlans();
      const database = await getDb();
      if (!database) return [];
      return database.select().from(subscriptionPlans).orderBy(asc(subscriptionPlans.id));
    }),

    adminUpdatePlan: protectedProcedure
      .input(
        z.object({
          planId: z.number().int().positive(),
          name: z.string().trim().min(1).max(255).optional(),
          description: z.string().trim().max(4000).optional().nullable(),
          priceMonthly: z.number().int().min(0).max(10_000_000).optional(),
          priceYearly: z.number().int().min(0).max(10_000_000).optional(),
          maxStudents: z.number().int().min(0).max(100_000).optional(),
          maxLessons: z.number().int().min(0).max(100_000).optional(),
          maxStorageMb: z.number().int().min(0).max(10_000_000).optional(),
          isActive: z.boolean().optional(),
          features: z.record(z.string(), z.boolean()).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        requireOwner(ctx);

        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const rows = await database
          .select()
          .from(subscriptionPlans)
          .where(eq(subscriptionPlans.id, input.planId))
          .limit(1);

        const existing = rows[0];
        if (!existing) {
          throw new TRPCError({ code: "NOT_FOUND", message: "الباقة غير موجودة." });
        }

        let mergedFeatures: Record<string, boolean> | undefined;
        if (input.features) {
          let currentFeatures: Record<string, boolean> = {};
          try {
            const parsed = JSON.parse(String(existing.features || "{}")) as unknown;
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
              for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
                currentFeatures[String(key)] = Boolean(value);
              }
            }
          } catch {
            currentFeatures = {};
          }

          mergedFeatures = { ...currentFeatures, ...input.features };
        }

        await database
          .update(subscriptionPlans)
          .set({
            name: input.name,
            description: input.description === null ? null : (input.description ?? undefined),
            priceMonthly: input.priceMonthly,
            priceYearly: input.priceYearly,
            maxStudents: input.maxStudents,
            maxLessons: input.maxLessons,
            maxStorageMb: input.maxStorageMb,
            isActive: input.isActive,
            features: mergedFeatures ? JSON.stringify(mergedFeatures) : undefined,
          })
          .where(eq(subscriptionPlans.id, input.planId));

        await logAdminAction(ctx, {
          action: "update_subscription",
          targetOpenId: `subscription_plan:${input.planId}`,
          details: `تم تحديث باقة الاشتراك رقم ${input.planId}.`,
        });

        return { success: true };
      }),

    adminSetPlanActive: protectedProcedure
      .input(
        z.object({
          planId: z.number().int().positive(),
          isActive: z.boolean(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const { ENV } = await import("./_core/env");
        if (ctx.user.openId !== ENV.ownerOpenId) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }

        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        await database
          .update(subscriptionPlans)
          .set({ isActive: input.isActive })
          .where(eq(subscriptionPlans.id, input.planId));

        await logAdminAction(ctx, {
          action: "update_subscription",
          targetOpenId: `subscription_plan:${input.planId}`,
          details: `تم ${input.isActive ? "تفعيل" : "تعطيل"} باقة الاشتراك رقم ${input.planId}.`,
        });

        return { success: true };
      }),

    adminListTeachers: protectedProcedure.query(async ({ ctx }) => {
      const { ENV } = await import("./_core/env");
      if (ctx.user.openId !== ENV.ownerOpenId) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      await ensureDefaultSubscriptionPlans();
      const database = await getDb();
      if (!database) return [];

      const teachers = await listTeacherUsersForSubscriptions();
      const rows = await Promise.all(
        teachers.map(async (teacher) => {
          const teacherId = Number(teacher.id);
          const status = await getTeacherSubscriptionStatus(teacherId);
          const studentsCovered = await countTeacherBeneficiaryStudents(teacherId);

          const latestEventRows = await database
            .select({
              eventType: subscriptionEvents.eventType,
              createdAt: subscriptionEvents.createdAt,
            })
            .from(subscriptionEvents)
            .innerJoin(teacherSubscriptions, eq(teacherSubscriptions.id, subscriptionEvents.teacherSubscriptionId))
            .where(eq(teacherSubscriptions.teacherId, teacherId))
            .orderBy(desc(subscriptionEvents.createdAt))
            .limit(1);

          const latestEvent = latestEventRows[0] || null;
          const currentPeriodEnd = status.subscription?.currentPeriodEnd
            ? new Date(status.subscription.currentPeriodEnd)
            : null;
          const now = new Date();
          const daysRemaining =
            currentPeriodEnd && status.isActive
              ? Math.max(0, Math.ceil((currentPeriodEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)))
              : null;

          let subscriptionStatus: "none" | "active" | "trialing" | "expired" | "canceled" = "none";
          if (status.subscription) {
            const rawStatus = String(status.subscription.status || "");
            if (rawStatus === "trialing") {
              subscriptionStatus = "trialing";
            } else if (rawStatus === "canceled") {
              subscriptionStatus = "canceled";
            } else if (status.isActive) {
              subscriptionStatus = "active";
            } else {
              subscriptionStatus = "expired";
            }
          }

          return {
            teacher,
            subscription: status.subscription,
            plan: status.plan,
            isActive: status.isActive,
            studentsCovered,
            identifier: teacher.email || teacher.openId,
            subscriptionStatus,
            currentPlanName: status.plan?.name || null,
            startsAt: status.subscription?.startsAt || null,
            endsAt: status.subscription?.currentPeriodEnd || null,
            daysRemaining,
            latestEvent,
          };
        }),
      );

      return rows;
    }),

    adminSubscriptionSummary: protectedProcedure.query(async ({ ctx }) => {
      const { ENV } = await import("./_core/env");
      if (ctx.user.openId !== ENV.ownerOpenId) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      const teacherRows = await listTeacherUsersForSubscriptions();
      const teachers = await Promise.all(
        teacherRows.map(async (teacher) => {
          const status = await getTeacherSubscriptionStatus(Number(teacher.id));
          return status;
        }),
      );

      const totalTeachers = teacherRows.length;
      const activeSubscriptions = teachers.filter((row) => row.isActive).length;
      const expiredSubscriptions = teachers.filter((row) => row.hasSubscription && !row.isActive).length;

      const database = await getDb();
      if (!database) {
        return {
          totalTeachers,
          activeSubscriptions,
          expiredSubscriptions,
          pendingRequests: 0,
          activeActivationCodes: 0,
        };
      }

      const requestRows = await database
        .select({
          id: subscriptionEvents.id,
          payload: subscriptionEvents.payload,
        })
        .from(subscriptionEvents)
        .where(
          inArray(subscriptionEvents.eventType, [
            "teacher_request_activation",
            "teacher_request_renewal",
            "teacher_request_details",
          ]),
        )
        .orderBy(desc(subscriptionEvents.createdAt))
        .limit(300);

      const statusRows = await database
        .select({ payload: subscriptionEvents.payload })
        .from(subscriptionEvents)
        .where(inArray(subscriptionEvents.eventType, ["admin_request_processed", "admin_request_rejected"]))
        .orderBy(desc(subscriptionEvents.createdAt))
        .limit(500);

      const handledIds = new Set<number>();
      for (const row of statusRows) {
        try {
          const parsed = JSON.parse(String(row.payload || "{}")) as { requestEventId?: number };
          const requestEventId = Number(parsed.requestEventId || 0);
          if (requestEventId > 0) handledIds.add(requestEventId);
        } catch {
          // Ignore malformed payload rows in stats.
        }
      }

      const pendingRequests = requestRows.filter((row) => !handledIds.has(Number(row.id))).length;

      const [activeCodesRow] = await database
        .select({ count: sql<number>`count(*)` })
        .from(subscriptionActivationCodes)
        .where(eq(subscriptionActivationCodes.status, "active"));

      return {
        totalTeachers,
        activeSubscriptions,
        expiredSubscriptions,
        pendingRequests,
        activeActivationCodes: Number(activeCodesRow?.count || 0),
      };
    }),

    adminSubscriptionDiagnostics: protectedProcedure.query(async ({ ctx }) => {
      const { ENV } = await import("./_core/env");
      if (ctx.user.openId !== ENV.ownerOpenId) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      const sanitizeError = (error: unknown): string => {
        const raw = String((error as { message?: unknown } | null)?.message || error || "").trim();
        if (!raw) return "Unknown error";

        return raw
          .replace(/mysql:\/\/[^\s@]+@/gi, "mysql://***@")
          .replace(/password\s*=\s*[^\s;]+/gi, "password=***")
          .replace(/pwd\s*=\s*[^\s;]+/gi, "pwd=***")
          .slice(0, 280);
      };

      const defaultTables = {
        subscription_plans: false,
        teacher_subscriptions: false,
        subscription_events: false,
        subscription_activation_codes: false,
      };
      const subscriptionTableNames = Object.keys(defaultTables) as Array<keyof typeof defaultTables>;

      let database = null as Awaited<ReturnType<typeof getDb>>;
      let lastError: string | null = null;
      try {
        database = await getDb();
      } catch (error) {
        lastError = sanitizeError(error);
      }

      if (!database) {
        return {
          dbAvailable: false,
          tables: defaultTables,
          plansCount: 0,
          activePlansCount: 0,
          usersByRole: [] as Array<{ role: string; count: number }>,
          teacherProfilesCount: 0,
          teachersWithClassesCount: 0,
          teachersFromSubscriptionSourceCount: 0,
          plans: [] as Array<{
            code: string;
            name: string;
            priceMonthly: number;
            priceYearly: number;
            maxStudents: number;
            maxLessons: number;
            isActive: boolean;
            featureKeys: string[];
          }>,
          lastError,
        };
      }

      try {
        await database.execute(sql`select 1 as ok`);
      } catch (error) {
        return {
          dbAvailable: false,
          tables: defaultTables,
          plansCount: 0,
          activePlansCount: 0,
          usersByRole: [] as Array<{ role: string; count: number }>,
          teacherProfilesCount: 0,
          teachersWithClassesCount: 0,
          teachersFromSubscriptionSourceCount: 0,
          plans: [] as Array<{
            code: string;
            name: string;
            priceMonthly: number;
            priceYearly: number;
            maxStudents: number;
            maxLessons: number;
            isActive: boolean;
            featureKeys: string[];
          }>,
          lastError: sanitizeError(error),
        };
      }

      const tables = { ...defaultTables };
      const tableCheckQueries: Record<keyof typeof defaultTables, SQL<unknown>> = {
        subscription_plans: sql`select 1 from subscription_plans limit 1`,
        teacher_subscriptions: sql`select 1 from teacher_subscriptions limit 1`,
        subscription_events: sql`select 1 from subscription_events limit 1`,
        subscription_activation_codes: sql`select 1 from subscription_activation_codes limit 1`,
      };

      for (const tableName of subscriptionTableNames) {
        try {
          await database.execute(tableCheckQueries[tableName]);
          tables[tableName] = true;
        } catch (error) {
          tables[tableName] = false;
          lastError = sanitizeError(error);
        }
      }

      let plansCount = 0;
      let activePlansCount = 0;
      let plans: Array<{
        code: string;
        name: string;
        priceMonthly: number;
        priceYearly: number;
        maxStudents: number;
        maxLessons: number;
        isActive: boolean;
        featureKeys: string[];
      }> = [];
      try {
        const [plansRow] = await database
          .select({ count: sql<number>`count(*)` })
          .from(subscriptionPlans);
        plansCount = Number(plansRow?.count || 0);

        const [activePlansRow] = await database
          .select({ count: sql<number>`count(*)` })
          .from(subscriptionPlans)
          .where(eq(subscriptionPlans.isActive, true));
        activePlansCount = Number(activePlansRow?.count || 0);

        const planRows = await database
          .select({
            code: subscriptionPlans.code,
            name: subscriptionPlans.name,
            priceMonthly: subscriptionPlans.priceMonthly,
            priceYearly: subscriptionPlans.priceYearly,
            maxStudents: subscriptionPlans.maxStudents,
            maxLessons: subscriptionPlans.maxLessons,
            isActive: subscriptionPlans.isActive,
            features: subscriptionPlans.features,
          })
          .from(subscriptionPlans)
          .orderBy(asc(subscriptionPlans.id));

        plans = planRows.map((plan) => {
          let featureKeys: string[] = [];
          try {
            const parsedFeatures = JSON.parse(String(plan.features || "{}")) as unknown;
            if (parsedFeatures && typeof parsedFeatures === "object" && !Array.isArray(parsedFeatures)) {
              featureKeys = Object.keys(parsedFeatures as Record<string, unknown>).sort();
            }
          } catch {
            featureKeys = [];
          }

          return {
            code: String(plan.code || ""),
            name: String(plan.name || ""),
            priceMonthly: Number(plan.priceMonthly || 0),
            priceYearly: Number(plan.priceYearly || 0),
            maxStudents: Number(plan.maxStudents || 0),
            maxLessons: Number(plan.maxLessons || 0),
            isActive: Boolean(plan.isActive),
            featureKeys,
          };
        });
      } catch (error) {
        lastError = sanitizeError(error);
      }

      let usersByRole: Array<{ role: string; count: number }> = [];
      let teacherProfilesCount = 0;
      let teachersWithClassesCount = 0;
      try {
        const usersRoleRows = await database
          .select({ role: users.role, count: sql<number>`count(*)` })
          .from(users)
          .groupBy(users.role)
          .orderBy(users.role);

        usersByRole = usersRoleRows.map((row) => ({
          role: String(row.role || "unknown"),
          count: Number(row.count || 0),
        }));

        const [teacherProfilesRow] = await database
          .select({ count: sql<number>`count(*)` })
          .from(teacherProfiles);
        teacherProfilesCount = Number(teacherProfilesRow?.count || 0);

        const [classTeachersRow] = await database
          .select({ count: sql<number>`count(distinct ${classes.teacherId})` })
          .from(classes);
        teachersWithClassesCount = Number(classTeachersRow?.count || 0);
      } catch (error) {
        lastError = sanitizeError(error);
      }

      let teachersFromSubscriptionSourceCount = 0;
      try {
        const teachers = await listTeacherUsersForSubscriptions();
        teachersFromSubscriptionSourceCount = teachers.length;
      } catch (error) {
        lastError = sanitizeError(error);
      }

      return {
        dbAvailable: true,
        tables,
        plansCount,
        activePlansCount,
        usersByRole,
        teacherProfilesCount,
        teachersWithClassesCount,
        teachersFromSubscriptionSourceCount,
        plans,
        lastError,
      };
    }),

    adminGetEvents: protectedProcedure
      .input(z.object({ teacherId: z.number().int().positive() }))
      .query(async ({ ctx, input }) => {
        const { ENV } = await import("./_core/env");
        if (ctx.user.openId !== ENV.ownerOpenId) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }

        const database = await getDb();
        if (!database) return [];

        return database
          .select({
            event: subscriptionEvents,
            subscription: teacherSubscriptions,
            plan: subscriptionPlans,
          })
          .from(subscriptionEvents)
          .innerJoin(teacherSubscriptions, eq(teacherSubscriptions.id, subscriptionEvents.teacherSubscriptionId))
          .leftJoin(subscriptionPlans, eq(subscriptionPlans.id, teacherSubscriptions.planId))
          .where(eq(teacherSubscriptions.teacherId, input.teacherId))
          .orderBy(desc(subscriptionEvents.createdAt));
      }),

    adminListRequestEvents: protectedProcedure.query(async ({ ctx }) => {
      const { ENV } = await import("./_core/env");
      if (ctx.user.openId !== ENV.ownerOpenId) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      const database = await getDb();
      if (!database) return [];

      const requestRows = await database
        .select({
          event: subscriptionEvents,
          subscription: teacherSubscriptions,
          plan: subscriptionPlans,
          teacher: { id: users.id, name: users.name, email: users.email },
        })
        .from(subscriptionEvents)
        .innerJoin(teacherSubscriptions, eq(teacherSubscriptions.id, subscriptionEvents.teacherSubscriptionId))
        .leftJoin(subscriptionPlans, eq(subscriptionPlans.id, teacherSubscriptions.planId))
        .leftJoin(users, eq(users.id, teacherSubscriptions.teacherId))
        .where(
          inArray(subscriptionEvents.eventType, [
            "teacher_request_activation",
            "teacher_request_renewal",
            "teacher_request_details",
          ]),
        )
        .orderBy(desc(subscriptionEvents.createdAt))
        .limit(100);

      const statusEvents = await database
        .select({ event: subscriptionEvents })
        .from(subscriptionEvents)
        .where(inArray(subscriptionEvents.eventType, ["admin_request_processed", "admin_request_rejected"]))
        .orderBy(desc(subscriptionEvents.createdAt))
        .limit(300);

      const requestStatusById: Record<number, { status: "processed" | "rejected"; at: Date | null }> = {};
      for (const row of statusEvents) {
        try {
          const payload = JSON.parse(String(row.event.payload || "{}")) as { requestEventId?: number };
          const requestEventId = Number(payload.requestEventId || 0);
          if (!requestEventId || requestStatusById[requestEventId]) continue;

          requestStatusById[requestEventId] = {
            status: row.event.eventType === "admin_request_rejected" ? "rejected" : "processed",
            at: row.event.createdAt || null,
          };
        } catch {
          // Ignore malformed event payloads.
        }
      }

      return requestRows.map((row) => {
        let payload: Record<string, unknown> = {};
        try {
          payload = row.event.payload ? (JSON.parse(String(row.event.payload)) as Record<string, unknown>) : {};
        } catch {
          payload = {};
        }

        const trackedStatus = requestStatusById[Number(row.event.id)] || null;
        const requestType =
          row.event.eventType === "teacher_request_activation"
            ? "activation"
            : row.event.eventType === "teacher_request_renewal"
              ? "renewal"
              : "details";

        return {
          ...row,
          requestType,
          requestNote: String(payload.note || ""),
          requestStatus: trackedStatus?.status || "new",
          requestStatusAt: trackedStatus?.at || null,
        };
      });
    }),

    adminProcessRequest: protectedProcedure
      .input(
        z.object({
          requestEventId: z.number().int().positive(),
          action: z.enum(["processed", "rejected"]),
          notes: z.string().max(2000).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const { ENV } = await import("./_core/env");
        if (ctx.user.openId !== ENV.ownerOpenId) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }

        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const requestRows = await database
          .select({ event: subscriptionEvents, subscription: teacherSubscriptions })
          .from(subscriptionEvents)
          .innerJoin(teacherSubscriptions, eq(teacherSubscriptions.id, subscriptionEvents.teacherSubscriptionId))
          .where(eq(subscriptionEvents.id, input.requestEventId))
          .limit(1);

        const requestRow = requestRows[0];
        if (!requestRow) {
          throw new TRPCError({ code: "NOT_FOUND", message: "طلب الاشتراك غير موجود." });
        }

        if (
          ![
            "teacher_request_activation",
            "teacher_request_renewal",
            "teacher_request_details",
          ].includes(String(requestRow.event.eventType))
        ) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "العنصر المحدد ليس طلب اشتراك." });
        }

        await logSubscriptionEvent({
          teacherSubscriptionId: Number(requestRow.subscription.id),
          eventType: input.action === "rejected" ? "admin_request_rejected" : "admin_request_processed",
          payload: {
            requestEventId: input.requestEventId,
            actorUserId: ctx.user.id,
            teacherId: Number(requestRow.subscription.teacherId),
            notes: input.notes || null,
          },
        });

        await logAdminAction(ctx, {
          action: "update_subscription",
          targetOpenId: `subscription_request:${input.requestEventId}`,
          details: `تم ${input.action === "rejected" ? "رفض" : "معالجة"} طلب اشتراك رقم ${input.requestEventId}.`,
        });

        return { success: true };
      }),

    createSupportRequest: publicProcedure
      .input(z.unknown())
      .mutation(async ({ ctx, input: rawInput }) => {
        const trackingId = `support-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const parsedInput = supportRequestInputSchema.safeParse(rawInput);
        if (!parsedInput.success) {
          const message = getSupportRequestValidationMessage(parsedInput.error.issues[0]);
          console.warn("[SupportRequest] Validation failed", {
            trackingId,
            issue: parsedInput.error.issues[0],
          });
          throw new TRPCError({
            code: "BAD_REQUEST",
            message,
          });
        }

        const input = parsedInput.data;
        const contactEmail = input.contactEmail || ctx.user?.email || undefined;
        const requesterName = input.requesterName || ctx.user?.name || undefined;

        if (!requesterName) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "الاسم مطلوب.",
          });
        }

        if (!ctx.user && !contactEmail) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "البريد الإلكتروني مطلوب حتى نستطيع التواصل معك بخصوص طلب الدعم.",
          });
        }

        if (!ctx.user && !contactEmail && !input.contactPhone) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "الرجاء إدخال بريد إلكتروني أو رقم هاتف حتى نتمكن من التواصل معك.",
          });
        }

        const database = await getDb();
        if (!database) {
          console.error("[SupportRequest] Database is not configured", { trackingId });
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "حدث خطأ مؤقت أثناء إرسال الطلب، يرجى المحاولة لاحقًا.",
          });
        }

        const existingFiltered: Array<unknown> = [];
        const fifteenMinutesAgo = new Date(Date.now() - 1000 * 60 * 15);
        const conditions = [
          gte(supportRequests.createdAt, fifteenMinutesAgo),
        ];

        if (ctx.user) {
          conditions.push(eq(supportRequests.userId, ctx.user.id));
        } else if (contactEmail) {
          conditions.push(eq(supportRequests.contactEmail, contactEmail));
        } else if (input.contactPhone) {
          conditions.push(eq(supportRequests.contactPhone, input.contactPhone));
        }

        let requestId = 0;
        try {
          if (conditions.length > 1) {
            const [countRow] = await database
              .select({ count: sql<number>`count(*)` })
              .from(supportRequests)
              .where(and(...conditions));

            if (Number(countRow?.count || 0) >= 3) {
              throw new TRPCError({
                code: "TOO_MANY_REQUESTS",
                message: "لقد تم إرسال عدة طلبات دعم خلال الفترة القصيرة الماضية. يرجى المحاولة لاحقًا.",
              });
            }
          }

          const insertResult = await database.insert(supportRequests).values({
            userId: ctx.user?.id ?? null,
            role: ctx.user?.role ?? "guest",
            requestType: input.requestType,
            title: input.title,
            message: input.message,
            requesterName,
            contactEmail,
            contactPhone: input.contactPhone,
            status: "new",
            adminNotes: null,
          });

          requestId = Number((insertResult as any)?.[0]?.insertId || (insertResult as any)?.insertId || 0);
          if (requestId <= 0) {
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "تعذر إرسال الطلب الآن، يرجى المحاولة لاحقًا.",
            });
          }
        } catch (error) {
          if (error instanceof TRPCError) {
            throw error;
          }

          console.error("[SupportRequest] Failed to save support request:", {
            trackingId,
            error,
          });
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "حدث خطأ مؤقت أثناء إرسال الطلب، يرجى المحاولة لاحقًا.",
          });
        }

        try {
          await notifyAdminSupportRequest({
            title: `طلب دعم جديد: ${getSupportRequestTypeLabel(input.requestType)}`,
            content: `تم استلام طلب دعم جديد.\n\nرقم التذكرة: ${requestId}\nنوع الطلب: ${getSupportRequestTypeLabel(input.requestType)}\n${input.title ? `العنوان: ${input.title}\n` : ""}الوصف:\n${input.message}\n\nالمستخدم: ${requesterName ?? "غير معروف"}\nالبريد: ${contactEmail ?? "-"}\nالهاتف: ${input.contactPhone ?? "-"}`,
            plainText: `طلب دعم جديد\n\nرقم التذكرة: ${requestId}\nنوع الطلب: ${getSupportRequestTypeLabel(input.requestType)}\n${input.title ? `العنوان: ${input.title}\n` : ""}الوصف:\n${input.message}\n\nالمستخدم: ${requesterName ?? "غير معروف"}\nالبريد: ${contactEmail ?? "-"}\nالهاتف: ${input.contactPhone ?? "-"}`,
          });
        } catch (error) {
          console.warn("[SupportRequest] Failed to send admin support notification", error);
        }

        try {
          await notifyUserSupportRequestCreated({
            to: contactEmail,
            requesterName,
            requestId,
            requestType: input.requestType,
            requestTypeLabel: getSupportRequestTypeLabel(input.requestType),
            title: input.title,
            message: input.message,
            createdAt: new Date(),
          });
        } catch (error) {
          console.warn("[SupportRequest] Failed to send user support created notification", error);
        }

        return {
          success: true,
          requestId,
          message: "تم إرسال طلب الدعم. سيقوم فريق الدعم بالتواصل معك قريبًا.",
        };
      }),

    adminListSupportRequests: protectedProcedure.query(async ({ ctx }) => {
      const { ENV } = await import("./_core/env");
      if (ctx.user.openId !== ENV.ownerOpenId) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      const database = await getDb();
      if (!database) return [];

      const rows = await database
        .select({
          request: supportRequests,
          user: { id: users.id, name: users.name, email: users.email },
        })
        .from(supportRequests)
        .leftJoin(users, eq(users.id, supportRequests.userId))
        .orderBy(desc(supportRequests.createdAt))
        .limit(200);

      return rows.map((row) => ({
        ...row.request,
        user: row.user,
      }));
    }),

    mySupportRequests: protectedProcedure.query(async ({ ctx }) => {
      const database = await getDb();
      if (!database) return [];

      return await database
        .select()
        .from(supportRequests)
        .where(eq(supportRequests.userId, ctx.user.id))
        .orderBy(desc(supportRequests.createdAt))
        .limit(100);
    }),

    adminUpdateSupportRequestStatus: protectedProcedure
      .input(
        z.object({
          supportRequestId: z.number().int().positive(),
          action: z.enum(["in_progress", "resolved", "rejected", "closed"]),
          notes: z.string().max(2000).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const { ENV } = await import("./_core/env");
        if (ctx.user.openId !== ENV.ownerOpenId) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }

        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const rows = await database
          .select()
          .from(supportRequests)
          .where(eq(supportRequests.id, input.supportRequestId))
          .limit(1);

        if (!rows[0]) {
          throw new TRPCError({ code: "NOT_FOUND", message: "طلب الدعم غير موجود." });
        }

        const nextAdminNotes = input.notes ?? rows[0].adminNotes;
        const nextResolvedAt = input.action === "resolved" ? new Date() : rows[0].resolvedAt;

        await database
          .update(supportRequests)
          .set({
            status: input.action,
            adminNotes: nextAdminNotes,
            updatedAt: new Date(),
            resolvedAt: nextResolvedAt,
          })
          .where(eq(supportRequests.id, input.supportRequestId));

        if (["resolved", "rejected", "closed"].includes(input.action)) {
          try {
            await notifyUserSupportRequestStatusChanged({
              to: rows[0].contactEmail,
              requesterName: rows[0].requesterName,
              requestId: Number(rows[0].id),
              requestType: String(rows[0].requestType),
              requestTypeLabel: getSupportRequestTypeLabel(String(rows[0].requestType)),
              title: rows[0].title,
              message: rows[0].message,
              status: input.action,
              statusLabel: getSupportRequestStatusLabel(input.action),
              adminNotes: nextAdminNotes,
              createdAt: rows[0].createdAt,
            });
          } catch (error) {
            console.warn("[SupportRequest] Failed to send user support status notification", error);
          }
        }

        return { success: true };
      }),

    adminListActivationCodeUsages: protectedProcedure
      .input(z.object({ codeId: z.number().int().positive() }))
      .query(async ({ ctx, input }) => {
        const { ENV } = await import("./_core/env");
        if (ctx.user.openId !== ENV.ownerOpenId) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }

        const database = await getDb();
        if (!database) return [];

        const rows = await database
          .select({
            event: subscriptionEvents,
            subscription: teacherSubscriptions,
            teacher: { id: users.id, name: users.name, email: users.email },
          })
          .from(subscriptionEvents)
          .innerJoin(teacherSubscriptions, eq(teacherSubscriptions.id, subscriptionEvents.teacherSubscriptionId))
          .leftJoin(users, eq(users.id, teacherSubscriptions.teacherId))
          .where(eq(subscriptionEvents.eventType, "teacher_redeem_activation_code"))
          .orderBy(desc(subscriptionEvents.createdAt))
          .limit(300);

        return rows.filter((row) => {
          try {
            const payload = JSON.parse(String(row.event.payload || "{}")) as { activationCodeId?: number };
            return Number(payload.activationCodeId || 0) === input.codeId;
          } catch {
            return false;
          }
        });
      }),

    adminListEvents: protectedProcedure.query(async ({ ctx }) => {
      const { ENV } = await import("./_core/env");
      if (ctx.user.openId !== ENV.ownerOpenId) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      const database = await getDb();
      if (!database) return [];

      return database
        .select({
          event: subscriptionEvents,
          subscription: teacherSubscriptions,
          plan: subscriptionPlans,
          teacher: { id: users.id, name: users.name, email: users.email },
        })
        .from(subscriptionEvents)
        .innerJoin(teacherSubscriptions, eq(teacherSubscriptions.id, subscriptionEvents.teacherSubscriptionId))
        .leftJoin(subscriptionPlans, eq(subscriptionPlans.id, teacherSubscriptions.planId))
        .leftJoin(users, eq(users.id, teacherSubscriptions.teacherId))
        .orderBy(desc(subscriptionEvents.createdAt))
        .limit(200);
    }),

    adminListActivationCodes: protectedProcedure.query(async ({ ctx }) => {
      const { ENV } = await import("./_core/env");
      if (ctx.user.openId !== ENV.ownerOpenId) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      const database = await getDb();
      if (!database) return [];

      return database
        .select({
          code: subscriptionActivationCodes,
          plan: subscriptionPlans,
          admin: { id: users.id, name: users.name, email: users.email },
        })
        .from(subscriptionActivationCodes)
        .leftJoin(subscriptionPlans, eq(subscriptionPlans.id, subscriptionActivationCodes.planId))
        .leftJoin(users, eq(users.id, subscriptionActivationCodes.createdByAdminId))
        .orderBy(desc(subscriptionActivationCodes.createdAt));
    }),

    adminCreateActivationCode: protectedProcedure
      .input(
        z.object({
          code: z.string().trim().min(3).max(120).optional(),
          planId: z.number().int().positive(),
          durationDays: z.number().int().min(1).max(3650),
          maxRedemptions: z.number().int().min(1).max(10000).default(1),
          expiresAt: z.coerce.date().optional(),
          startsAt: z.coerce.date().optional(),
          notes: z.string().max(2000).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const { ENV } = await import("./_core/env");
        if (ctx.user.openId !== ENV.ownerOpenId) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }

        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const generatedCode = input.code?.trim().toUpperCase() || `ART-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;

        if (input.expiresAt && input.startsAt && new Date(input.expiresAt) <= new Date(input.startsAt)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "تاريخ انتهاء الكود يجب أن يكون بعد تاريخ البداية.",
          });
        }

        // Placeholder only: discount/coupon logic will be added with payment integration phase.
        await database.insert(subscriptionActivationCodes).values({
          code: generatedCode,
          planId: input.planId,
          status: "active",
          durationDays: input.durationDays,
          maxRedemptions: input.maxRedemptions,
          redeemedCount: 0,
          startsAt: input.startsAt || null,
          expiresAt: input.expiresAt || null,
          createdByAdminId: ctx.user.id,
          notes: input.notes || null,
        });

        await logAdminAction(ctx, {
          action: "update_subscription",
          targetOpenId: `subscription_plan:${input.planId}`,
          details: `تم إنشاء كود تفعيل لباقة الاشتراك رقم ${input.planId} لمدة ${input.durationDays} يومًا. لم يتم تسجيل الكود في سجل العمليات.`,
        });

        return { success: true, code: generatedCode };
      }),

    adminDisableActivationCode: protectedProcedure
      .input(z.object({ codeId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        const { ENV } = await import("./_core/env");
        if (ctx.user.openId !== ENV.ownerOpenId) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }

        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        await database
          .update(subscriptionActivationCodes)
          .set({ status: "disabled" })
          .where(eq(subscriptionActivationCodes.id, input.codeId));

        await logAdminAction(ctx, {
          action: "update_subscription",
          targetOpenId: `activation_code:${input.codeId}`,
          details: "تم تعطيل كود تفعيل اشتراك.",
        });

        return { success: true };
      }),

    adminActivateManual: protectedProcedure
      .input(
        z.object({
          teacherId: z.number().int().positive(),
          planId: z.number().int().positive(),
          months: z.number().int().min(1).max(24).optional(),
          durationDays: z.number().int().min(1).max(3650).optional(),
          startDate: z.coerce.date().optional(),
          endDate: z.coerce.date().optional(),
          notes: z.string().max(2000).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const { ENV } = await import("./_core/env");
        if (ctx.user.openId !== ENV.ownerOpenId) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }

        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const now = new Date();
        const periodStart = input.startDate ? new Date(input.startDate) : now;
        const periodEnd = input.endDate ? new Date(input.endDate) : new Date(periodStart);
        if (!input.endDate) {
          const months = Number(input.months || 0);
          const days = Number(input.durationDays || 0);
          if (months <= 0 && days <= 0) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "حدّد مدة الاشتراك بالأشهر أو الأيام، أو أدخل تاريخ نهاية واضح.",
            });
          }

          if (months > 0) {
            periodEnd.setMonth(periodEnd.getMonth() + months);
          }
          if (days > 0) {
            periodEnd.setDate(periodEnd.getDate() + days);
          }
        }

        if (periodEnd <= periodStart) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "تاريخ نهاية الاشتراك يجب أن يكون بعد تاريخ البداية.",
          });
        }

        await database.insert(teacherSubscriptions).values({
          teacherId: input.teacherId,
          planId: input.planId,
          status: "manual",
          source: "admin_grant",
          startsAt: periodStart,
          currentPeriodStart: periodStart,
          currentPeriodEnd: periodEnd,
          notes: input.notes || null,
        });

        const [created] = await database
          .select({ id: teacherSubscriptions.id })
          .from(teacherSubscriptions)
          .where(eq(teacherSubscriptions.teacherId, input.teacherId))
          .orderBy(desc(teacherSubscriptions.id))
          .limit(1);

        if (created?.id) {
          await logSubscriptionEvent({
            teacherSubscriptionId: Number(created.id),
            eventType: "admin_activate_manual",
            payload: {
              actorUserId: ctx.user.id,
              months: Number(input.months || 0) || null,
              durationDays: Number(input.durationDays || 0) || null,
              startDate: periodStart.toISOString(),
              endDate: periodEnd.toISOString(),
              notes: input.notes || null,
            },
          });
        }

        await logAdminAction(ctx, {
          action: "update_subscription",
          targetOpenId: `teacher:${input.teacherId}`,
          details: `تم تفعيل اشتراك يدوي للمعلم رقم ${input.teacherId} على الباقة رقم ${input.planId}.`,
        });

        return { success: true };
      }),

    adminExtend: protectedProcedure
      .input(
        z.object({
          subscriptionId: z.number().int().positive(),
          months: z.number().int().min(1).max(24).optional(),
          days: z.number().int().min(1).max(3650).optional(),
          endDate: z.coerce.date().optional(),
          notes: z.string().max(2000).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const { ENV } = await import("./_core/env");
        if (ctx.user.openId !== ENV.ownerOpenId) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }

        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const rows = await database
          .select()
          .from(teacherSubscriptions)
          .where(eq(teacherSubscriptions.id, input.subscriptionId))
          .limit(1);
        const current = rows[0];
        if (!current) throw new TRPCError({ code: "NOT_FOUND", message: "الاشتراك غير موجود" });

        const now = new Date();
        const baseDate = current.currentPeriodEnd && current.currentPeriodEnd > now
          ? new Date(current.currentPeriodEnd)
          : now;

        const extensionMonths = Number(input.months || 0);
        const extensionDays = Number(input.days || 0);
        const hasExplicitEndDate = Boolean(input.endDate);

        if (!hasExplicitEndDate && extensionMonths <= 0 && extensionDays <= 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "أدخل مدة التمديد بالأيام أو الأشهر، أو اختر تاريخ نهاية جديد.",
          });
        }

        const nextPeriodEnd = hasExplicitEndDate ? new Date(input.endDate as Date) : new Date(baseDate);
        if (!hasExplicitEndDate) {
          if (extensionMonths > 0) {
            nextPeriodEnd.setMonth(nextPeriodEnd.getMonth() + extensionMonths);
          }
          if (extensionDays > 0) {
            nextPeriodEnd.setDate(nextPeriodEnd.getDate() + extensionDays);
          }
        }

        if (nextPeriodEnd <= now) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "تاريخ نهاية الاشتراك الجديد يجب أن يكون في المستقبل.",
          });
        }

        await database
          .update(teacherSubscriptions)
          .set({
            currentPeriodEnd: nextPeriodEnd,
            status: current.status === "canceled" || current.status === "expired" ? "manual" : current.status,
            notes: input.notes || current.notes || null,
          })
          .where(eq(teacherSubscriptions.id, input.subscriptionId));

        await logSubscriptionEvent({
          teacherSubscriptionId: input.subscriptionId,
          eventType: "admin_extend",
          payload: {
            actorUserId: ctx.user.id,
            months: extensionMonths || null,
            days: extensionDays || null,
            endDate: hasExplicitEndDate ? nextPeriodEnd.toISOString() : null,
            notes: input.notes || null,
            newPeriodEnd: nextPeriodEnd.toISOString(),
          },
        });

        await logAdminAction(ctx, {
          action: "update_subscription",
          targetOpenId: `subscription:${input.subscriptionId}`,
          details: `تم تمديد الاشتراك رقم ${input.subscriptionId}.`,
        });

        return { success: true };
      }),

    adminCancel: protectedProcedure
      .input(z.object({ subscriptionId: z.number().int().positive(), notes: z.string().max(2000).optional() }))
      .mutation(async ({ ctx, input }) => {
        const { ENV } = await import("./_core/env");
        if (ctx.user.openId !== ENV.ownerOpenId) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }

        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        await database
          .update(teacherSubscriptions)
          .set({
            status: "canceled",
            canceledAt: new Date(),
            notes: input.notes || null,
          })
          .where(eq(teacherSubscriptions.id, input.subscriptionId));

        await logSubscriptionEvent({
          teacherSubscriptionId: input.subscriptionId,
          eventType: "admin_cancel",
          payload: { actorUserId: ctx.user.id, notes: input.notes || null },
        });

        await logAdminAction(ctx, {
          action: "update_subscription",
          targetOpenId: `subscription:${input.subscriptionId}`,
          details: `تم إلغاء الاشتراك رقم ${input.subscriptionId}.`,
        });

        return { success: true };
      }),

    adminChangePlan: protectedProcedure
      .input(
        z.object({
          subscriptionId: z.number().int().positive(),
          planId: z.number().int().positive(),
          notes: z.string().max(2000).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const { ENV } = await import("./_core/env");
        if (ctx.user.openId !== ENV.ownerOpenId) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }

        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        await database
          .update(teacherSubscriptions)
          .set({
            planId: input.planId,
            notes: input.notes || null,
          })
          .where(eq(teacherSubscriptions.id, input.subscriptionId));

        await logSubscriptionEvent({
          teacherSubscriptionId: input.subscriptionId,
          eventType: "admin_change_plan",
          payload: { actorUserId: ctx.user.id, planId: input.planId, notes: input.notes || null },
        });

        await logAdminAction(ctx, {
          action: "update_subscription",
          targetOpenId: `subscription:${input.subscriptionId}`,
          details: `تم تغيير باقة الاشتراك رقم ${input.subscriptionId} إلى الباقة رقم ${input.planId}.`,
        });

        return { success: true };
      }),
  }),

  adminVideoImport: router({
    createJob: protectedProcedure
      .input(
        z.object({
          sourceUrl: z.string().url(),
          sourceType: z.string().trim().min(1).max(64),
          title: z.string().trim().min(1).max(255),
          lessonId: z.number().int().positive().optional(),
          rightsConfirmed: z.boolean(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "هذه الواجهة مخصصة للإدارة فقط" });
        }

        if (!input.rightsConfirmed) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "يجب تأكيد حقوق استخدام المحتوى قبل إنشاء الطلب" });
        }

        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        await database
          .insert(videoImportJobs)
          .values({
            sourceUrl: input.sourceUrl.trim(),
            sourceType: input.sourceType.trim(),
            title: input.title.trim(),
            lessonId: input.lessonId ?? null,
            requestedByUserId: ctx.user.id,
            rightsConfirmed: true,
            status: "queued",
          });

        return { success: true, status: "queued" as const };
      }),

    startJob: protectedProcedure
      .input(z.object({ jobId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "هذه الواجهة مخصصة للإدارة فقط" });
        }

        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const rows = await database
          .select()
          .from(videoImportJobs)
          .where(eq(videoImportJobs.id, input.jobId))
          .limit(1);

        const job = rows[0];
        if (!job) {
          throw new TRPCError({ code: "NOT_FOUND", message: "لم يتم العثور على مهمة استيراد الفيديو" });
        }

        if (!job.rightsConfirmed) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "لا يمكن بدء المهمة بدون تأكيد حقوق المحتوى" });
        }

        if (job.status !== "queued" && job.status !== "failed") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "يمكن بدء المهام بحالة queued أو failed فقط" });
        }

        try {
          const metubeTask = await submitToMeTube(job.sourceUrl);

          await database
            .update(videoImportJobs)
            .set({
              status: "downloading",
              metubeTaskId: metubeTask.taskId,
              errorMessage: null,
              completedAt: null,
            })
            .where(eq(videoImportJobs.id, input.jobId));

          return {
            success: true,
            jobId: input.jobId,
            status: "downloading" as const,
            metubeTaskId: metubeTask.taskId,
          };
        } catch (error) {
          const safeMessage =
            error instanceof MeTubeIntegrationError
              ? error.safeMessage
              : "تعذر بدء المهمة على MeTube. تحقق من الإعدادات ثم أعد المحاولة.";

          await database
            .update(videoImportJobs)
            .set({
              status: "failed",
              errorMessage: safeMessage,
              completedAt: new Date(),
            })
            .where(eq(videoImportJobs.id, input.jobId));

          return {
            success: false,
            jobId: input.jobId,
            status: "failed" as const,
            message: safeMessage,
          };
        }
      }),

    refreshJobStatus: protectedProcedure
      .input(z.object({ jobId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "هذه الواجهة مخصصة للإدارة فقط" });
        }

        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const rows = await database
          .select()
          .from(videoImportJobs)
          .where(eq(videoImportJobs.id, input.jobId))
          .limit(1);

        const job = rows[0];
        if (!job) {
          throw new TRPCError({ code: "NOT_FOUND", message: "لم يتم العثور على مهمة استيراد الفيديو" });
        }

        if (!job.rightsConfirmed) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "لا يمكن تحديث المهمة بدون تأكيد حقوق المحتوى" });
        }

        // Do not overwrite a cancelled job with stale MeTube status
        if (job.status === "cancelled") {
          return {
            success: false,
            jobId: input.jobId,
            status: "cancelled" as const,
            message: "المهمة ملغاة — لا يمكن تحديث حالتها من MeTube.",
          };
        }

        const metubeTaskId = String(job.metubeTaskId || "").trim();
        if (!metubeTaskId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "لا يوجد معرف مهمة MeTube لهذه الوظيفة" });
        }

        try {
          const metubeTask = await pollMeTubeTaskStatus(metubeTaskId);
          const normalizedStorageProvider = String(metubeTask.storageProvider || "").trim();
          const normalizedRemoteObjectKey = String(metubeTask.remoteObjectKey || "").trim();
          const normalizedRemoteBucket = String(metubeTask.remoteBucket || "").trim();
          const normalizedRemoteUrl = String(metubeTask.remoteUrl || "").trim();
          const trustedRemoteUrl = isRemoteUrlTrustedForImport({
            remoteUrl: normalizedRemoteUrl,
            sourceUrl: job.sourceUrl,
          })
            ? normalizedRemoteUrl
            : "";
          const hasRemoteStorageBinding =
            Boolean(normalizedStorageProvider) ||
            Boolean(normalizedRemoteObjectKey) ||
            Boolean(normalizedRemoteBucket) ||
            Boolean(trustedRemoteUrl);

          const updateData: Record<string, unknown> = {
            status: metubeTask.localStatus,
            errorMessage: metubeTask.localStatus === "failed"
              ? (metubeTask.errorMessage || "فشلت عملية التحميل في MeTube")
              : null,
            metubeTaskId: metubeTask.taskId || metubeTaskId,
          };

          if (metubeTask.fileName) updateData.fileName = metubeTask.fileName;
          if (metubeTask.outputPath) updateData.outputPath = metubeTask.outputPath;
          if (metubeTask.mimeType) updateData.mimeType = metubeTask.mimeType;
          if (typeof metubeTask.fileSize === "number") updateData.fileSize = metubeTask.fileSize;
          if (normalizedStorageProvider) updateData.storageProvider = normalizedStorageProvider;
          if (normalizedRemoteObjectKey) updateData.remoteObjectKey = normalizedRemoteObjectKey;
          if (normalizedRemoteBucket) updateData.remoteBucket = normalizedRemoteBucket;
          if (trustedRemoteUrl) {
            updateData.remoteUrl = trustedRemoteUrl;
          } else if (hasRemoteStorageBinding && String(job.remoteUrl || "").trim()) {
            updateData.remoteUrl = null;
          }

          if (metubeTask.localStatus === "completed" || metubeTask.localStatus === "failed") {
            updateData.completedAt = new Date();
          }

          if (metubeTask.localStatus === "downloading") {
            updateData.completedAt = null;
          }

          await database
            .update(videoImportJobs)
            .set(updateData)
            .where(eq(videoImportJobs.id, input.jobId));

          return {
            success: metubeTask.localStatus !== "failed",
            jobId: input.jobId,
            status: metubeTask.localStatus,
            metubeTaskId: metubeTask.taskId,
            rawStatus: metubeTask.rawStatus,
            fileName: metubeTask.fileName,
            outputPath: metubeTask.outputPath,
            mimeType: metubeTask.mimeType,
            fileSize: metubeTask.fileSize,
            storageProvider: normalizedStorageProvider || null,
            remoteObjectKey: normalizedRemoteObjectKey || null,
            remoteBucket: normalizedRemoteBucket || null,
            remoteUrl: trustedRemoteUrl || null,
            errorMessage: metubeTask.localStatus === "failed"
              ? (metubeTask.errorMessage || "فشلت عملية التحميل في MeTube")
              : null,
          };
        } catch (error) {
          const safeMessage =
            error instanceof MeTubeIntegrationError
              ? error.safeMessage
              : "تعذر تحديث حالة المهمة من MeTube. حاول مرة أخرى.";

          await database
            .update(videoImportJobs)
            .set({
              status: "failed",
              errorMessage: safeMessage,
              completedAt: new Date(),
            })
            .where(eq(videoImportJobs.id, input.jobId));

          return {
            success: false,
            jobId: input.jobId,
            status: "failed" as const,
            message: safeMessage,
          };
        }
      }),

    finalizeJobImport: protectedProcedure
      .input(z.object({ jobId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "هذه الواجهة مخصصة للإدارة فقط" });
        }

        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const rows = await database
          .select()
          .from(videoImportJobs)
          .where(eq(videoImportJobs.id, input.jobId))
          .limit(1);

        const job = rows[0];
        if (!job) {
          throw new TRPCError({ code: "NOT_FOUND", message: "لم يتم العثور على مهمة استيراد الفيديو" });
        }

        if (!job.rightsConfirmed) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "لا يمكن استيراد الملف بدون تأكيد حقوق المحتوى" });
        }

        if (job.status !== "completed") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "لا يمكن استيراد الملف إلا بعد اكتمال التحميل في MeTube" });
        }

        if (job.uploadedAssetId) {
          return {
            success: true,
            alreadyImported: true,
            jobId: input.jobId,
            uploadedAssetId: Number(job.uploadedAssetId),
            fileName: job.fileName,
            outputPath: job.outputPath,
            mimeType: job.mimeType,
            fileSize: job.fileSize,
            fileExtension: job.fileExtension,
            importedAt: job.importedAt,
          };
        }

        try {
          const remoteCandidate = await resolveRemoteFinalizeCandidateForJob(job);

          if (!remoteCandidate) {
            const safeMessage =
              "remote_finalize_required: يتطلب هذا النشر بيانات Spaces/CDN حقيقية من MeTube (remoteObjectKey أو remoteUrl موثوق).";

            await database
              .update(videoImportJobs)
              .set({
                status: "failed",
                errorMessage: safeMessage,
              })
              .where(eq(videoImportJobs.id, input.jobId));

            return {
              success: false,
              jobId: input.jobId,
              status: "failed" as const,
              message: safeMessage,
            };
          }

          const registeredRemote = await registerImportedVideoAssetFromRemote(database, {
            job,
            remote: remoteCandidate,
          });

          await attachAssetReferenceToJob(database, {
            job,
            binding: {
              uploadedAssetId: registeredRemote.uploadedAssetId,
              outputPath: remoteCandidate.objectKey || remoteCandidate.publicUrl,
              fileName: remoteCandidate.fileName,
              mimeType: remoteCandidate.mimeType,
              fileSize: remoteCandidate.fileSize,
              fileExtension: path.extname(remoteCandidate.fileName) || null,
              storageProvider: registeredRemote.provider,
              remoteObjectKey: registeredRemote.objectKey,
              remoteBucket: registeredRemote.bucket,
              remoteUrl: registeredRemote.publicUrl,
              finalizedFrom: "spaces",
            },
          });

          return {
            success: true,
            alreadyImported: false,
            jobId: input.jobId,
            uploadedAssetId: registeredRemote.uploadedAssetId,
            fileName: remoteCandidate.fileName,
            outputPath: remoteCandidate.objectKey || remoteCandidate.publicUrl,
            mimeType: remoteCandidate.mimeType,
            fileSize: remoteCandidate.fileSize,
            fileExtension: path.extname(remoteCandidate.fileName) || null,
            finalizedFrom: "spaces" as const,
          };
        } catch (error) {
          const safeMessage =
            error instanceof VideoImportFinalizeError
              ? `remote_finalize_required: ${error.safeMessage}`
              : "remote_finalize_required: تعذر تثبيت الفيديو من بيانات Spaces/CDN. تحقق من metadata الصادرة من MeTube.";

          await database
            .update(videoImportJobs)
            .set({
              status: "failed",
              errorMessage: safeMessage,
            })
            .where(eq(videoImportJobs.id, input.jobId));

          return {
            success: false,
            jobId: input.jobId,
            status: "failed" as const,
            message: safeMessage,
          };
        }
      }),

    listJobs: protectedProcedure
      .input(z.object({ limit: z.number().int().min(1).max(100).optional() }).optional())
      .query(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "هذه الواجهة مخصصة للإدارة فقط" });
        }

        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const limit = input?.limit || 30;
        return database
          .select()
          .from(videoImportJobs)
          .orderBy(desc(videoImportJobs.createdAt))
          .limit(limit);
      }),

    getJob: protectedProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .query(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "هذه الواجهة مخصصة للإدارة فقط" });
        }

        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const rows = await database
          .select()
          .from(videoImportJobs)
          .where(eq(videoImportJobs.id, input.id))
          .limit(1);

        if (!rows[0]) {
          throw new TRPCError({ code: "NOT_FOUND", message: "لم يتم العثور على مهمة استيراد الفيديو" });
        }

        return rows[0];
      }),

    markFailed: protectedProcedure
      .input(
        z.object({
          id: z.number().int().positive(),
          errorMessage: z.string().trim().min(1).max(2000),
        })
      )
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "هذه الواجهة مخصصة للإدارة فقط" });
        }

        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        await database
          .update(videoImportJobs)
          .set({
            status: "failed",
            errorMessage: input.errorMessage,
            completedAt: new Date(),
          })
          .where(eq(videoImportJobs.id, input.id));

        return { success: true, id: input.id };
      }),

    markCompleted: protectedProcedure
      .input(
        z.object({
          id: z.number().int().positive(),
          metubeTaskId: z.string().trim().max(191).optional(),
          outputPath: z.string().trim().max(2000).optional(),
          fileName: z.string().trim().max(255).optional(),
          fileSize: z.number().int().nonnegative().optional(),
          mimeType: z.string().trim().max(191).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "هذه الواجهة مخصصة للإدارة فقط" });
        }

        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        await database
          .update(videoImportJobs)
          .set({
            status: "completed",
            metubeTaskId: input.metubeTaskId ?? null,
            outputPath: input.outputPath ?? null,
            fileName: input.fileName ?? null,
            fileSize: input.fileSize ?? null,
            mimeType: input.mimeType ?? null,
            errorMessage: null,
            completedAt: new Date(),
          })
          .where(eq(videoImportJobs.id, input.id));

        return { success: true, id: input.id };
      }),

    cancelJob: protectedProcedure
      .input(z.object({ jobId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "هذه الواجهة مخصصة للإدارة فقط" });
        }

        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const rows = await database
          .select({
            id: videoImportJobs.id,
            status: videoImportJobs.status,
            metubeTaskId: videoImportJobs.metubeTaskId,
            remoteObjectKey: videoImportJobs.remoteObjectKey,
            uploadedAssetId: videoImportJobs.uploadedAssetId,
          })
          .from(videoImportJobs)
          .where(eq(videoImportJobs.id, input.jobId))
          .limit(1);

        const job = rows[0];
        if (!job) {
          throw new TRPCError({ code: "NOT_FOUND", message: "لم يتم العثور على مهمة الاستيراد" });
        }

        // If the job already has an uploadedAsset, it completed the import cycle — not cancellable here
        if (job.uploadedAssetId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "هذه المهمة أنتجت أصلًا مستوردًا بالفعل. استخدم إجراءات الحذف/unlink لإدارة الأصل.",
          });
        }

        const cancellableStatuses = ["queued", "downloading", "completed", "failed"] as const;
        const alreadyCancelled = job.status === "cancelled";
        if (!alreadyCancelled && !cancellableStatuses.includes(job.status as typeof cancellableStatuses[number])) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `الحالة الحالية (${job.status}) لا تدعم الإلغاء.`,
          });
        }

        // 1) Mark as cancelled immediately in DB (before any async work)
        await database
          .update(videoImportJobs)
          .set({
            status: "cancelled",
            errorMessage: "تم الإلغاء بواسطة المسؤول",
            completedAt: new Date(),
          })
          .where(eq(videoImportJobs.id, input.jobId));

        // 2) Best-effort: tell MeTube bridge to cancel the task
        let metubeCancel: { attempted: boolean; success: boolean; note: string } = {
          attempted: false,
          success: false,
          note: "no_metube_task_id",
        };
        const metubeTaskId = String(job.metubeTaskId || "").trim();
        if (metubeTaskId) {
          try {
            metubeCancel = await cancelMeTubeTask(metubeTaskId);
          } catch {
            metubeCancel = { attempted: true, success: false, note: "cancel_threw_unexpected" };
          }
        }

        // 3) Best-effort: delete orphan Spaces object if it exists and the job has no imported asset
        let spacesCleanup: { attempted: boolean; success: boolean; objectKey: string | null } = {
          attempted: false,
          success: false,
          objectKey: null,
        };
        const remoteObjectKey = String(job.remoteObjectKey || "").trim();
        if (remoteObjectKey) {
          spacesCleanup.attempted = true;
          spacesCleanup.objectKey = remoteObjectKey;
          try {
            await storageDelete(remoteObjectKey);
            spacesCleanup.success = true;
          } catch {
            // Non-fatal — orphan GC will handle it later
          }
        }

        return {
          success: true,
          jobId: input.jobId,
          previousStatus: job.status,
          metubeCancel,
          spacesCleanup,
        };
      }),

    deleteJob: protectedProcedure
      .input(z.object({ jobId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "هذه الواجهة مخصصة للإدارة فقط" });
        }

        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const rows = await database
          .select()
          .from(videoImportJobs)
          .where(eq(videoImportJobs.id, input.jobId))
          .limit(1);

        const job = rows[0];
        if (!job) {
          throw new TRPCError({ code: "NOT_FOUND", message: "لم يتم العثور على مهمة استيراد الفيديو" });
        }

        // Block deletion of active jobs that have not been cancelled yet.
        // Active = queued or downloading with no uploadedAsset yet.
        // This prevents silent orphaning: caller must cancel first.
        const isActiveWithNoAsset =
          (job.status === "queued" || job.status === "downloading") &&
          !job.uploadedAssetId;
        if (isActiveWithNoAsset) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "لا يمكن حذف مهمة نشطة مباشرةً. استخدم إلغاء المهمة أولًا لإيقاف التنفيذ في MeTube ثم يمكن حذف السجل.",
          });
        }

        const uploadedAssetId = Number(job.uploadedAssetId || 0);
        let deletedAssetId: number | null = null;
        let assetKeptReason: string | null = null;

        if (uploadedAssetId > 0) {
          const lessonLinks = await database
            .select({ id: lessonVideoAssets.id, lessonId: lessonVideoAssets.lessonId })
            .from(lessonVideoAssets)
            .where(eq(lessonVideoAssets.uploadedAssetId, uploadedAssetId))
            .limit(1);

          if (lessonLinks[0]) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "لا يمكن حذف هذا الطلب لأن الفيديو مرتبط بدرس. قم بإزالة الربط أولًا.",
            });
          }

          const referencesCount = await countAssetActiveReferences(database, uploadedAssetId);
          if (referencesCount > 0) {
            assetKeptReason = `تم حذف الطلب فقط لأن الأصل لديه ${referencesCount} مرجع/مراجع نشطة.`;
          } else {
            assetKeptReason = "تم حذف الطلب فقط وتم الإبقاء على أصل الفيديو كمرشح orphan لإعادة الاستخدام أو purge لاحق آمن.";
          }
        }

        await database
          .delete(uploadedAssetReferences)
          .where(
            and(
              eq(uploadedAssetReferences.entityType, "videoImportJobs"),
              eq(uploadedAssetReferences.entityId, input.jobId),
              eq(uploadedAssetReferences.fieldName, "outputAssetId")
            )
          );

        await database
          .delete(videoImportJobs)
          .where(eq(videoImportJobs.id, input.jobId));

        return {
          success: true,
          deletedJobId: input.jobId,
          deletedAssetId,
          assetKeptReason,
        };
      }),
  }),

  adminLessonVideos: router({
    attachImportedVideo: protectedProcedure
      .input(
        z.object({
          lessonId: z.number().int().positive(),
          uploadedAssetId: z.number().int().positive(),
          title: z.string().trim().max(255).optional(),
          isPrimary: z.boolean().optional(),
          displayOrder: z.number().int().min(0).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "هذه الواجهة مخصصة للإدارة فقط" });
        }

        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        try {
          await ensureLessonExists(database, input.lessonId);
          await ensureAttachableVideoAsset(database, input.uploadedAssetId);

          const existingRows = await database
            .select({
              id: lessonVideoAssets.id,
              lessonId: lessonVideoAssets.lessonId,
              uploadedAssetId: lessonVideoAssets.uploadedAssetId,
              displayOrder: lessonVideoAssets.displayOrder,
            })
            .from(lessonVideoAssets)
            .where(
              and(
                eq(lessonVideoAssets.lessonId, input.lessonId),
                eq(lessonVideoAssets.uploadedAssetId, input.uploadedAssetId)
              )
            )
            .limit(1);

          let attachmentId = Number(existingRows[0]?.id || 0);
          const publishNowPayload = {
            isPublished: true,
            visibleToStudents: true,
            publishedAt: new Date(),
            publishedByUserId: Number(ctx.user.id),
          };

          if (attachmentId) {
            const updateData: Record<string, unknown> = { ...publishNowPayload };
            if (typeof input.title === "string") {
              const normalizedTitle = input.title.trim();
              updateData.title = normalizedTitle || null;
            }
            if (typeof input.displayOrder === "number") {
              updateData.displayOrder = input.displayOrder;
            }

            if (Object.keys(updateData).length > 0) {
              await database
                .update(lessonVideoAssets)
                .set(updateData)
                .where(eq(lessonVideoAssets.id, attachmentId));
            }
          } else {
            const displayOrder =
              typeof input.displayOrder === "number"
                ? input.displayOrder
                : await computeNextDisplayOrder(database, input.lessonId);

            await database.insert(lessonVideoAssets).values({
              lessonId: input.lessonId,
              uploadedAssetId: input.uploadedAssetId,
              title: input.title?.trim() ? input.title.trim() : null,
              displayOrder,
              isPrimary: false,
              ...publishNowPayload,
            });

            const insertedRows = await database
              .select({ id: lessonVideoAssets.id })
              .from(lessonVideoAssets)
              .where(
                and(
                  eq(lessonVideoAssets.lessonId, input.lessonId),
                  eq(lessonVideoAssets.uploadedAssetId, input.uploadedAssetId)
                )
              )
              .orderBy(desc(lessonVideoAssets.id))
              .limit(1);

            attachmentId = Number(insertedRows[0]?.id || 0);
          }

          if (!attachmentId) {
            throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "تعذر حفظ ربط الفيديو بالدرس" });
          }

          const shouldSetPrimary = input.isPrimary === true;
          if (shouldSetPrimary) {
            await ensurePrimaryForLesson(database, input.lessonId, attachmentId);
          } else {
            const primaryRows = await database
              .select({ id: lessonVideoAssets.id })
              .from(lessonVideoAssets)
              .where(and(eq(lessonVideoAssets.lessonId, input.lessonId), eq(lessonVideoAssets.isPrimary, true)))
              .limit(1);

            if (!primaryRows[0]) {
              await ensurePrimaryForLesson(database, input.lessonId, attachmentId);
            }
          }

          const linkedImportJob = await findImportJobByAsset(database, input.uploadedAssetId);
          if (linkedImportJob) {
            await database
              .update(videoImportJobs)
              .set({ lessonId: input.lessonId })
              .where(eq(videoImportJobs.id, linkedImportJob.id));
          }

          return {
            success: true,
            lessonId: input.lessonId,
            uploadedAssetId: input.uploadedAssetId,
            attachmentId,
          };
        } catch (error) {
          if (error instanceof LessonVideoAssetsError) {
            throw new TRPCError({ code: "BAD_REQUEST", message: error.safeMessage });
          }
          if (error instanceof TRPCError) throw error;
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "تعذر ربط الفيديو بالدرس" });
        }
      }),

    listByLesson: protectedProcedure
      .input(z.object({ lessonId: z.number().int().positive() }))
      .query(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "هذه الواجهة مخصصة للإدارة فقط" });
        }

        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        await ensureLessonExists(database, input.lessonId);
        return listLessonVideoAttachments(database, input.lessonId);
      }),

    publishAttachment: protectedProcedure
      .input(
        z.object({
          attachmentId: z.number().int().positive(),
          visibleToStudents: z.boolean().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "هذه الواجهة مخصصة للإدارة فقط" });
        }

        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const rows = await database
          .select({
            id: lessonVideoAssets.id,
            lessonId: lessonVideoAssets.lessonId,
          })
          .from(lessonVideoAssets)
          .where(eq(lessonVideoAssets.id, input.attachmentId))
          .limit(1);

        if (!rows[0]) {
          throw new TRPCError({ code: "NOT_FOUND", message: "لم يتم العثور على الربط المطلوب" });
        }

        await database
          .update(lessonVideoAssets)
          .set({
            isPublished: true,
            visibleToStudents: input.visibleToStudents ?? true,
            publishedAt: new Date(),
            publishedByUserId: Number(ctx.user.id),
          })
          .where(eq(lessonVideoAssets.id, input.attachmentId));

        return {
          success: true,
          attachmentId: input.attachmentId,
          lessonId: Number(rows[0].lessonId),
        };
      }),

    unpublishAttachment: protectedProcedure
      .input(z.object({ attachmentId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "هذه الواجهة مخصصة للإدارة فقط" });
        }

        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const rows = await database
          .select({
            id: lessonVideoAssets.id,
            lessonId: lessonVideoAssets.lessonId,
          })
          .from(lessonVideoAssets)
          .where(eq(lessonVideoAssets.id, input.attachmentId))
          .limit(1);

        if (!rows[0]) {
          throw new TRPCError({ code: "NOT_FOUND", message: "لم يتم العثور على الربط المطلوب" });
        }

        await database
          .update(lessonVideoAssets)
          .set({
            isPublished: false,
            visibleToStudents: false,
            publishedAt: null,
            publishedByUserId: null,
          })
          .where(eq(lessonVideoAssets.id, input.attachmentId));

        return {
          success: true,
          attachmentId: input.attachmentId,
          lessonId: Number(rows[0].lessonId),
        };
      }),

    updateVisibility: protectedProcedure
      .input(
        z.object({
          attachmentId: z.number().int().positive(),
          visibleToStudents: z.boolean(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "هذه الواجهة مخصصة للإدارة فقط" });
        }

        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const rows = await database
          .select({
            id: lessonVideoAssets.id,
            lessonId: lessonVideoAssets.lessonId,
            isPublished: lessonVideoAssets.isPublished,
          })
          .from(lessonVideoAssets)
          .where(eq(lessonVideoAssets.id, input.attachmentId))
          .limit(1);

        const attachment = rows[0];
        if (!attachment) {
          throw new TRPCError({ code: "NOT_FOUND", message: "لم يتم العثور على الربط المطلوب" });
        }

        if (input.visibleToStudents && !attachment.isPublished) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "لا يمكن إظهار فيديو للطلاب قبل نشره.",
          });
        }

        await database
          .update(lessonVideoAssets)
          .set({ visibleToStudents: input.visibleToStudents })
          .where(eq(lessonVideoAssets.id, input.attachmentId));

        return {
          success: true,
          attachmentId: input.attachmentId,
          lessonId: Number(attachment.lessonId),
          visibleToStudents: input.visibleToStudents,
        };
      }),

    removeAttachment: protectedProcedure
      .input(z.object({ attachmentId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "هذه الواجهة مخصصة للإدارة فقط" });
        }

        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const rows = await database
          .select({
            id: lessonVideoAssets.id,
            lessonId: lessonVideoAssets.lessonId,
            isPrimary: lessonVideoAssets.isPrimary,
          })
          .from(lessonVideoAssets)
          .where(eq(lessonVideoAssets.id, input.attachmentId))
          .limit(1);

        const attachment = rows[0];
        if (!attachment) {
          throw new TRPCError({ code: "NOT_FOUND", message: "لم يتم العثور على الربط المطلوب" });
        }

        await database.delete(lessonVideoAssets).where(eq(lessonVideoAssets.id, input.attachmentId));

        if (attachment.isPrimary) {
          const nextRows = await database
            .select({ id: lessonVideoAssets.id })
            .from(lessonVideoAssets)
            .where(eq(lessonVideoAssets.lessonId, attachment.lessonId))
            .orderBy(asc(lessonVideoAssets.displayOrder), desc(lessonVideoAssets.id))
            .limit(1);

          if (nextRows[0]?.id) {
            await ensurePrimaryForLesson(database, Number(attachment.lessonId), Number(nextRows[0].id));
          }
        }

        return { success: true, attachmentId: input.attachmentId };
      }),

    setPrimary: protectedProcedure
      .input(z.object({ attachmentId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "هذه الواجهة مخصصة للإدارة فقط" });
        }

        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const rows = await database
          .select({
            id: lessonVideoAssets.id,
            lessonId: lessonVideoAssets.lessonId,
          })
          .from(lessonVideoAssets)
          .where(eq(lessonVideoAssets.id, input.attachmentId))
          .limit(1);

        if (!rows[0]) {
          throw new TRPCError({ code: "NOT_FOUND", message: "لم يتم العثور على الربط المطلوب" });
        }

        await ensurePrimaryForLesson(database, Number(rows[0].lessonId), Number(rows[0].id));

        return { success: true, attachmentId: input.attachmentId, lessonId: Number(rows[0].lessonId) };
      }),
  }),

  videoCenter: router({
    listLibraryAssets: protectedProcedure
      .input(
        z
          .object({
            onlyVideo: z.boolean().optional(),
            includeDeleted: z.boolean().optional(),
          })
          .optional()
      )
      .query(async ({ ctx, input }) => {
        if (ctx.user.role !== "teacher" && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN" });
        }

        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const rows = await database
          .select({
            id: uploadedAssets.id,
            provider: uploadedAssets.provider,
            bucket: uploadedAssets.bucket,
            objectKey: uploadedAssets.objectKey,
            publicUrl: uploadedAssets.publicUrl,
            mimeType: uploadedAssets.mimeType,
            fileSize: uploadedAssets.fileSize,
            sourceType: uploadedAssets.sourceType,
            ownershipContext: uploadedAssets.ownershipContext,
            uploadedVia: uploadedAssets.uploadedVia,
            isExternal: uploadedAssets.isExternal,
            manualKeep: uploadedAssets.manualKeep,
            status: uploadedAssets.status,
            createdAt: uploadedAssets.createdAt,
            updatedAt: uploadedAssets.updatedAt,
          })
          .from(uploadedAssets)
          .orderBy(desc(uploadedAssets.createdAt));

        const filtered = rows
          .filter((row) => (input?.includeDeleted ? true : String(row.status || "") !== "deleted"))
          .filter((row) => (input?.onlyVideo === false ? true : String(row.mimeType || "").toLowerCase().startsWith("video/")));

        const withUsage = await Promise.all(
          filtered.map(async (row) => {
            const lessonUsageRows = await database
              .select({ count: sql<number>`count(*)` })
              .from(lessonVideoAssets)
              .where(eq(lessonVideoAssets.uploadedAssetId, Number(row.id)));

            const activeRefs = await countAssetActiveReferences(database, Number(row.id));
            const lessonUsageCount = Number(lessonUsageRows[0]?.count || 0);

            // Get related lesson name for display
            let relatedLessonTitle: string | null = null;
            if (lessonUsageCount > 0) {
              const firstLesson = await database
                .select({ title: lessons.title })
                .from(lessonVideoAssets)
                .innerJoin(lessons, eq(lessons.id, lessonVideoAssets.lessonId))
                .where(eq(lessonVideoAssets.uploadedAssetId, Number(row.id)))
                .limit(1);
              relatedLessonTitle = firstLesson[0]?.title || null;
            }

            return {
              ...row,
              lessonUsageCount,
              activeReferences: activeRefs,
              relatedLessonTitle,
              displayTitle: relatedLessonTitle || null, // Will be computed on client if null
              sourceLabel:
                String(row.sourceType || "") === "metube_video_import"
                  ? "مستورد من يوتيوب"
                  : row.isExternal
                    ? "خارجي"
                    : "محلي",
            };
          })
        );

        return withUsage;
      }),

    listLessonUsages: protectedProcedure
      .input(
        z
          .object({
            uploadedAssetId: z.number().int().positive().optional(),
          })
          .optional()
      )
      .query(async ({ ctx, input }) => {
        if (ctx.user.role !== "teacher" && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN" });
        }

        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const rows = await database
          .select({
            attachmentId: lessonVideoAssets.id,
            lessonId: lessonVideoAssets.lessonId,
            lessonTitle: lessons.title,
            uploadedAssetId: lessonVideoAssets.uploadedAssetId,
            title: lessonVideoAssets.title,
            displayOrder: lessonVideoAssets.displayOrder,
            startSeconds: lessonVideoAssets.startSeconds,
            endSeconds: lessonVideoAssets.endSeconds,
            isPublished: lessonVideoAssets.isPublished,
            visibleToStudents: lessonVideoAssets.visibleToStudents,
            isPrimary: lessonVideoAssets.isPrimary,
            sourceType: uploadedAssets.sourceType,
            mimeType: uploadedAssets.mimeType,
            publicUrl: uploadedAssets.publicUrl,
            objectKey: uploadedAssets.objectKey,
            assetStatus: uploadedAssets.status,
          })
          .from(lessonVideoAssets)
          .innerJoin(uploadedAssets, eq(uploadedAssets.id, lessonVideoAssets.uploadedAssetId))
          .innerJoin(lessons, eq(lessons.id, lessonVideoAssets.lessonId))
          .where(
            input?.uploadedAssetId
              ? eq(lessonVideoAssets.uploadedAssetId, input.uploadedAssetId)
              : sql`1 = 1`
          )
          .orderBy(desc(lessonVideoAssets.updatedAt), desc(lessonVideoAssets.id));

        return rows.map((row) => ({
          ...row,
          // Prefer lesson name as display title, then fallback to computed name
          displayVideoTitle: row.lessonTitle || null,
        }));
      }),

    setAssetManualKeep: protectedProcedure
      .input(z.object({ assetId: z.number().int().positive(), manualKeep: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "هذه العملية مخصصة للإدارة" });
        }

        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        await database
          .update(uploadedAssets)
          .set({ manualKeep: input.manualKeep })
          .where(eq(uploadedAssets.id, input.assetId));

        return { success: true, assetId: input.assetId, manualKeep: input.manualKeep };
      }),

    deleteAssetPermanently: protectedProcedure
      .input(z.object({ assetId: z.number().int().positive(), execute: z.boolean().default(false) }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "هذه العملية مخصصة للإدارة" });
        }

        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const refs = await countAssetActiveReferences(database, input.assetId);
        if (refs > 0) {
          return {
            success: false,
            assetId: input.assetId,
            outcome: "still-referenced" as const,
            message: `لا يمكن حذف الأصل نهائيًا لأنه ما زال مستخدمًا (${refs} references).`,
          };
        }

        const result = await safelyDeleteAssetIfUnreferenced(database, input.assetId, {
          dryRun: !input.execute,
          reason: "admin-permanent-purge",
        });

        return {
          success: result.outcome === "deleted" || result.outcome === "dry-run",
          assetId: input.assetId,
          outcome: result.outcome,
          detail: result.detail || null,
        };
      }),

    previewOrphanAssets: protectedProcedure
      .input(
        z
          .object({
            graceHours: z.number().int().min(1).max(24 * 30).optional(),
            limit: z.number().int().min(1).max(1000).optional(),
          })
          .optional()
      )
      .query(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "هذه العملية مخصصة للإدارة" });
        }

        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const graceHours = Number(input?.graceHours || ENV.videoOrphanGraceHours || 72);
        const limit = Number(input?.limit || 200);
        const candidates = await listOrphanImportedAssetCandidates(database, { graceHours, limit });

        return {
          graceHours,
          candidates,
          count: candidates.length,
        };
      }),

    purgeOrphanAssets: protectedProcedure
      .input(
        z.object({
          graceHours: z.number().int().min(1).max(24 * 30).optional(),
          execute: z.boolean().default(false),
          limit: z.number().int().min(1).max(1000).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "هذه العملية مخصصة للإدارة" });
        }

        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const graceHours = Number(input.graceHours || ENV.videoOrphanGraceHours || 72);
        const limit = Number(input.limit || 200);

        const summary = await purgeOrphanImportedAssets(database, {
          graceHours,
          execute: input.execute,
          limit,
        });

        return {
          success: true,
          mode: input.execute ? "execute" : "dry-run",
          graceHours,
          ...summary,
        };
      }),
  }),

  // لوحة الإدارة (Admin Panel)
  admin: router({
    verifyOwner: protectedProcedure.query(async ({ ctx }) => {
      const { ENV } = await import("./_core/env");
      return ctx.user.openId === ENV.ownerOpenId;
    }),

    getAdminLoginSettings: protectedProcedure.query(async ({ ctx }) => {
      const { ENV } = await import("./_core/env");
      if (ctx.user.openId !== ENV.ownerOpenId) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      const database = await getDb();
      if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const auth = await resolveAdminAuth(database);
      return {
        username: auth.username,
        source: auth.source,
      };
    }),

    updateAdminLoginSettings: protectedProcedure
      .input(
        z.object({
          currentPassword: z.string().min(1),
          username: z.string().min(3).max(120),
          newPassword: z.string().min(4).max(120),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { ENV } = await import("./_core/env");
        if (ctx.user.openId !== ENV.ownerOpenId) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }

        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const currentAuth = await resolveAdminAuth(database);
        if (!checkAdminPassword(input.currentPassword, currentAuth)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "كلمة المرور الحالية غير صحيحة" });
        }

        await upsertAdminAuth(database, input.username.trim(), input.newPassword);
        await logAdminAction(ctx, {
          action: "update_admin_settings",
          targetOpenId: ctx.user.openId,
          details: "تم تحديث اسم مستخدم دخول الإدارة وإعدادات الدخول.",
        });

        return { success: true };
      }),

    users: router({
      summary: protectedProcedure.query(async ({ ctx }) => {
        const { ENV } = await import("./_core/env");
        if (ctx.user.openId !== ENV.ownerOpenId) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }

        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const [studentRows, teacherRows, bannedRows, pendingTeacherRequests] = await Promise.all([
          database
            .select({ count: sql<number>`count(*)` })
            .from(users)
            .where(or(eq(users.role, "student"), eq(users.role, "user"))),
          database
            .select({ count: sql<number>`count(*)` })
            .from(users)
            .where(eq(users.role, "teacher")),
          database.select({ count: sql<number>`count(*)` }).from(bannedUsers),
          listTeacherRegistrationRequests(database, "pending"),
        ]);

        return {
          students: Number(studentRows[0]?.count) || 0,
          teachers: Number(teacherRows[0]?.count) || 0,
          banned: Number(bannedRows[0]?.count) || 0,
          pendingTeachers: pendingTeacherRequests.length,
        };
      }),

      passwordResetTargets: protectedProcedure.query(async ({ ctx }) => {
        const { ENV } = await import("./_core/env");
        if (ctx.user.openId !== ENV.ownerOpenId) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }

        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const studentRows = await database
          .select({
            classStudentId: classStudents.id,
            studentId: users.id,
            studentName: classStudents.studentName,
            userName: users.name,
            openId: users.openId,
            role: users.role,
            className: classes.name,
            grade: classes.grade,
          })
          .from(classStudents)
          .innerJoin(users, eq(users.id, classStudents.studentId))
          .leftJoin(classes, eq(classes.id, classStudents.classId))
          .orderBy(classes.grade, classes.name, classStudents.studentName);

        const teacherRequests = await listTeacherRegistrationRequests(database, "approved");

        return {
          students: studentRows
            .filter((row) => row.openId !== ENV.ownerOpenId && row.role !== "admin")
            .map((row) => ({
              type: "student" as const,
              classStudentId: Number(row.classStudentId),
              userId: Number(row.studentId),
              name: row.studentName || row.userName || "طالب",
              className: row.className || "فصل غير محدد",
              grade: row.grade || "صف غير محدد",
            })),
          teachers: teacherRequests.map((row) => ({
            type: "teacher" as const,
            teacherRegistrationRequestId: Number(row.id),
            username: row.username,
            fullName: row.fullName,
          })),
        };
      }),

      listPaged: protectedProcedure
        .input(
          z
            .object({
              page: z.number().int().min(1).default(1),
              pageSize: z.number().int().min(10).max(50).default(25),
              search: z.string().max(120).optional().default(""),
              role: z.enum(["all", "student", "teacher", "admin", "user"]).optional().default("all"),
              status: z.enum(["all", "active", "banned"]).optional().default("all"),
              accountType: z.enum(["all", "linked_student", "teacher", "platform"]).optional().default("all"),
              sortBy: z.enum(["name", "role", "status", "createdAt", "lastSignedIn"]).optional().default("createdAt"),
              sortDir: z.enum(["asc", "desc"]).optional().default("desc"),
            })
            .optional()
        )
        .query(async ({ ctx, input }) => {
          const { ENV } = await import("./_core/env");
          if (ctx.user.openId !== ENV.ownerOpenId) {
            throw new TRPCError({ code: "FORBIDDEN", message: "هذه الصفحة مخصصة لمنشئ الموقع فقط" });
          }

          const database = await getDb();
          if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

          const params = {
            page: input?.page ?? 1,
            pageSize: input?.pageSize ?? 25,
            search: input?.search?.trim() ?? "",
            role: input?.role ?? "all",
            status: input?.status ?? "all",
            accountType: input?.accountType ?? "all",
            sortBy: input?.sortBy ?? "createdAt",
            sortDir: input?.sortDir ?? "desc",
          };

          const bannedExpr = sql<number>`EXISTS(SELECT 1 FROM ${bannedUsers} bu WHERE bu.openId = ${users.openId})`;
          const studentLinksExpr = sql<number>`(SELECT COUNT(*) FROM ${classStudents} cs WHERE cs.studentId = ${users.id})`;
          const teacherClassesExpr = sql<number>`(SELECT COUNT(*) FROM ${classes} c WHERE c.teacherId = ${users.id})`;

          const conditions: SQL[] = [];
          if (params.role !== "all") {
            conditions.push(eq(users.role, params.role));
          }
          if (params.status === "banned") {
            conditions.push(sql`${bannedExpr} = 1`);
          } else if (params.status === "active") {
            conditions.push(sql`${bannedExpr} = 0`);
          }
          if (params.accountType === "linked_student") {
            conditions.push(sql`${studentLinksExpr} > 0`);
          } else if (params.accountType === "teacher") {
            conditions.push(eq(users.role, "teacher"));
          } else if (params.accountType === "platform") {
            conditions.push(and(sql`${studentLinksExpr} = 0`, or(eq(users.role, "admin"), eq(users.role, "user")))!);
          }
          if (params.search) {
            const keyword = `%${params.search.toLowerCase()}%`;
            conditions.push(sql`(
              LOWER(COALESCE(${users.name}, '')) LIKE ${keyword}
              OR LOWER(COALESCE(${users.email}, '')) LIKE ${keyword}
              OR LOWER(${users.openId}) LIKE ${keyword}
            )`);
          }

          const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

          const orderTarget =
            params.sortBy === "name"
              ? sql`COALESCE(${users.name}, '')`
              : params.sortBy === "role"
                ? users.role
                : params.sortBy === "status"
                  ? bannedExpr
                  : params.sortBy === "lastSignedIn"
                    ? users.lastSignedIn
                    : users.createdAt;
          const orderBy = params.sortDir === "asc" ? asc(orderTarget) : desc(orderTarget);

          let countQuery: any = database.select({ count: sql<number>`count(*)` }).from(users);
          if (whereClause) countQuery = countQuery.where(whereClause);
          const countRows = await countQuery;
          const total = Number(countRows[0]?.count) || 0;
          const totalPages = Math.max(1, Math.ceil(total / params.pageSize));
          const page = Math.min(params.page, totalPages);
          const offset = (page - 1) * params.pageSize;

          let rowsQuery: any = database
            .select({
              id: users.id,
              name: users.name,
              email: users.email,
              maskedOpenId: sql<string>`CASE WHEN CHAR_LENGTH(${users.openId}) <= 10 THEN ${users.openId} ELSE CONCAT(LEFT(${users.openId}, 6), '...', RIGHT(${users.openId}, 4)) END`,
              role: users.role,
              createdAt: users.createdAt,
              updatedAt: users.updatedAt,
              lastSignedIn: users.lastSignedIn,
              isBanned: bannedExpr,
              studentLinksCount: studentLinksExpr,
              teacherClassesCount: teacherClassesExpr,
              isOwner: sql<number>`CASE WHEN ${users.openId} = ${ENV.ownerOpenId} THEN 1 ELSE 0 END`,
            })
            .from(users);
          if (whereClause) rowsQuery = rowsQuery.where(whereClause);
          const rows = await rowsQuery.orderBy(orderBy).limit(params.pageSize).offset(offset);

          return {
            items: rows.map((row: any) => ({
              ...row,
              isBanned: Number(row.isBanned) > 0,
              studentLinksCount: Number(row.studentLinksCount) || 0,
              teacherClassesCount: Number(row.teacherClassesCount) || 0,
              isOwner: Number(row.isOwner) > 0,
            })),
            total,
            page,
            pageSize: params.pageSize,
            totalPages,
          };
        }),

      getDetails: protectedProcedure
        .input(z.object({ userId: z.number().int().positive() }))
        .query(async ({ ctx, input }) => {
          const { ENV } = await import("./_core/env");
          if (ctx.user.openId !== ENV.ownerOpenId) {
            throw new TRPCError({ code: "FORBIDDEN" });
          }

          const database = await getDb();
          if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

          const userRows = await database
            .select({
              id: users.id,
              name: users.name,
              email: users.email,
              openId: users.openId,
              role: users.role,
              createdAt: users.createdAt,
              updatedAt: users.updatedAt,
              lastSignedIn: users.lastSignedIn,
              isBanned: sql<number>`EXISTS(SELECT 1 FROM ${bannedUsers} bu WHERE bu.openId = ${users.openId})`,
              isOwner: sql<number>`CASE WHEN ${users.openId} = ${ENV.ownerOpenId} THEN 1 ELSE 0 END`,
            })
            .from(users)
            .where(eq(users.id, input.userId))
            .limit(1);

          const target = userRows[0];
          if (!target) {
            throw new TRPCError({ code: "NOT_FOUND", message: "المستخدم غير موجود" });
          }

          let teacherLoginUsername: string | null = null;
          if (target.role === "teacher" || target.openId.startsWith("teacher_")) {
            const username = target.openId.replace(/^teacher_/, "");
            const teacher = await getTeacherRegistrationByUsername(database, username);
            teacherLoginUsername = teacher?.username || username || null;
          }

          const [studentLinks, teacherClassRows, latestLogs] = await Promise.all([
            database
              .select({
                classStudentId: classStudents.id,
                studentName: classStudents.studentName,
                classId: classes.id,
                className: classes.name,
                grade: classes.grade,
                joinedAt: classStudents.joinedAt,
              })
              .from(classStudents)
              .leftJoin(classes, eq(classes.id, classStudents.classId))
              .where(eq(classStudents.studentId, input.userId))
              .orderBy(classes.grade, classes.name, classStudents.studentName),
            database
              .select({
                classId: classes.id,
                className: classes.name,
                grade: classes.grade,
                createdAt: classes.createdAt,
              })
              .from(classes)
              .where(eq(classes.teacherId, input.userId))
              .orderBy(classes.grade, classes.name),
            database
              .select({
                id: adminActivityLogs.id,
                action: adminActivityLogs.action,
                targetOpenId: adminActivityLogs.targetOpenId,
                details: adminActivityLogs.details,
                createdAt: adminActivityLogs.createdAt,
              })
              .from(adminActivityLogs)
              .where(eq(adminActivityLogs.targetOpenId, target.openId))
              .orderBy(desc(adminActivityLogs.createdAt))
              .limit(8),
          ]);

          return {
            ...target,
            isBanned: Number(target.isBanned) > 0,
            isOwner: Number(target.isOwner) > 0,
            teacherLoginUsername,
            studentLinks,
            teacherClasses: teacherClassRows,
            latestLogs,
          };
        }),

      resetPasswordForUser: protectedProcedure
        .input(z.object({ userId: z.number().int().positive(), newPassword: z.string().min(4).max(120) }))
        .mutation(async ({ ctx, input }) => {
          requireOwner(ctx);

          const database = await getDb();
          if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

          const targetRows = await database
            .select({ id: users.id, openId: users.openId, role: users.role, name: users.name })
            .from(users)
            .where(eq(users.id, input.userId))
            .limit(1);
          const target = targetRows[0];
          if (!target) {
            throw new TRPCError({ code: "NOT_FOUND", message: "المستخدم غير موجود" });
          }
          if (target.openId === ENV.ownerOpenId || target.role === "admin") {
            await logAdminAction(ctx, {
              action: "blocked_reset_admin_password",
              targetOpenId: target.openId,
              details: "محاولة إعادة تعيين كلمة مرور مالك المنصة أو حساب إداري.",
            });
          }
          assertCanResetPassword(ctx, target);

          if (target.role === "teacher" || target.openId.startsWith("teacher_")) {
            const username = target.openId.replace(/^teacher_/, "");
            const teacher = await getTeacherRegistrationByUsername(database, username);
            if (!teacher || teacher.status !== "approved") {
              throw new TRPCError({
                code: "NOT_FOUND",
                message: "لم يتم العثور على طلب معلم معتمد مرتبط بهذا المستخدم.",
              });
            }

            const { hashAdminPassword } = await import("./_core/adminAuth");
            await database.execute(sql`
              UPDATE teacherRegistrationRequests
              SET passwordHash = ${hashAdminPassword(input.newPassword)}
              WHERE id = ${teacher.id}
            `);

            await logAdminAction(ctx, {
              action: "reset_teacher_password",
              targetOpenId: target.openId,
              details: `تمت إعادة تعيين كلمة مرور المعلم من جدول المستخدمين للطلب رقم ${teacher.id}`,
            });

            return {
              success: true,
              targetType: "teacher" as const,
              loginUsername: teacher.username,
              message: `تم تحديث كلمة مرور المعلم بنجاح. اسم المستخدم لتسجيل الدخول: ${teacher.username}`,
            };
          }

          const studentLinks = await database
            .select({ classStudentId: classStudents.id })
            .from(classStudents)
            .where(eq(classStudents.studentId, input.userId));

          if (studentLinks.length === 0) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "لم يتم العثور على ارتباط طالب يمكن تحديث كلمة مروره.",
            });
          }
          if (studentLinks.length > 1) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "هذا الطالب مرتبط بأكثر من فصل. استخدم اختيار المستخدم المحدد في نموذج إعادة التعيين أعلاه.",
            });
          }
          if (input.newPassword.length > 50) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "رمز دخول الطالب يجب ألا يتجاوز 50 حرفًا حاليًا.",
            });
          }

          // TODO phase 3: student class passwords are still stored as plain text in classStudents.password.
          await database
            .update(classStudents)
            .set({ password: input.newPassword })
            .where(eq(classStudents.id, Number(studentLinks[0].classStudentId)));

          await logAdminAction(ctx, {
            action: "reset_student_access_code",
            targetOpenId: target.openId,
            details: `تمت إعادة تعيين رمز دخول الطالب من جدول المستخدمين لسجل الفصل رقم ${studentLinks[0].classStudentId}`,
          });

          return {
            success: true,
            targetType: "student" as const,
            message: "تم تحديث رمز دخول الطالب بنجاح. يُستخدم هذا الرمز لدخول الطالب إلى المنصة.",
          };
        }),
    }),

    getTeacherRegistrationRequests: protectedProcedure
      .input(z.object({ status: z.enum(["pending", "approved", "rejected"]).optional() }).optional())
      .query(async ({ ctx, input }) => {
        const { ENV } = await import("./_core/env");
        if (ctx.user.openId !== ENV.ownerOpenId) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }

        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        return listTeacherRegistrationRequests(database, input?.status);
      }),

    approveTeacherRegistration: protectedProcedure
      .input(z.object({ requestId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        const { ENV } = await import("./_core/env");
        if (ctx.user.openId !== ENV.ownerOpenId) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }

        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const request = await getTeacherRegistrationById(database, input.requestId);
        if (!request) {
          throw new TRPCError({ code: "NOT_FOUND", message: "طلب تسجيل المعلم غير موجود" });
        }

        await updateTeacherRegistrationStatus(database, {
          id: input.requestId,
          status: "approved",
          reviewedByOpenId: ctx.user.openId,
        });
        await logAdminAction(ctx, {
          action: "approve_teacher_registration",
          targetOpenId: `teacher_request:${input.requestId}`,
          details: `تمت الموافقة على طلب المعلم: ${request.username}`,
        });
        return { success: true };
      }),

    rejectTeacherRegistration: protectedProcedure
      .input(z.object({ requestId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        const { ENV } = await import("./_core/env");
        if (ctx.user.openId !== ENV.ownerOpenId) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }

        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const request = await getTeacherRegistrationById(database, input.requestId);
        if (!request) {
          throw new TRPCError({ code: "NOT_FOUND", message: "طلب تسجيل المعلم غير موجود" });
        }

        await updateTeacherRegistrationStatus(database, {
          id: input.requestId,
          status: "rejected",
          reviewedByOpenId: ctx.user.openId,
        });
        await logAdminAction(ctx, {
          action: "reject_teacher_registration",
          targetOpenId: `teacher_request:${input.requestId}`,
          details: `تم رفض طلب المعلم: ${request.username}`,
        });
        return { success: true };
      }),

    resetUserPassword: protectedProcedure
      .input(
        z.discriminatedUnion("targetType", [
          z.object({
            targetType: z.literal("student"),
            classStudentId: z.number().int().positive(),
            newPassword: z.string().min(4).max(50),
          }),
          z.object({
            targetType: z.literal("teacher"),
            teacherRegistrationRequestId: z.number().int().positive(),
            newPassword: z.string().min(4).max(120),
          }),
        ])
      )
      .mutation(async ({ ctx, input }) => {
        const { ENV } = await import("./_core/env");
        if (ctx.user.openId !== ENV.ownerOpenId) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }

        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        if (input.targetType === "teacher") {
          const teacher = await getTeacherRegistrationById(database, input.teacherRegistrationRequestId);
          if (!teacher) {
            throw new TRPCError({ code: "NOT_FOUND", message: "لم يتم العثور على معلم مطابق." });
          }
          if (teacher.status !== "approved") {
            throw new TRPCError({ code: "BAD_REQUEST", message: "لا يمكن تغيير كلمة مرور معلم قبل اعتماد طلبه." });
          }

          const teacherOpenId = `teacher_${teacher.username.trim().toLowerCase()}`;
          const existingUser = await database
            .select({ id: users.id, role: users.role, openId: users.openId })
            .from(users)
            .where(eq(users.openId, teacherOpenId))
            .limit(1);

          if (teacherOpenId === ENV.ownerOpenId || existingUser[0]?.role === "admin") {
            await logAdminAction(ctx, {
              action: "blocked_reset_admin_password",
              targetOpenId: teacherOpenId,
              details: "محاولة إعادة تعيين كلمة مرور مالك المنصة أو حساب إداري.",
            });
          }
          assertCanResetPassword(ctx, {
            id: existingUser[0]?.id,
            openId: teacherOpenId,
            role: existingUser[0]?.role || "teacher",
          });

          const { hashAdminPassword } = await import("./_core/adminAuth");
          const hashed = hashAdminPassword(input.newPassword);
          await database.execute(sql`
            UPDATE teacherRegistrationRequests
            SET passwordHash = ${hashed}
            WHERE id = ${teacher.id}
          `);

          await logAdminAction(ctx, {
            action: "reset_teacher_password",
            targetOpenId: teacherOpenId,
            details: `تمت إعادة تعيين كلمة مرور المعلم للطلب رقم ${teacher.id}`,
          });

          return {
            success: true,
            targetType: "teacher" as const,
            loginUsername: teacher.username,
            message: `تم تحديث كلمة مرور المعلم بنجاح. اسم المستخدم لتسجيل الدخول: ${teacher.username}`,
          };
        }

        const studentRows = await database
          .select({
            classStudentId: classStudents.id,
            studentId: users.id,
            studentName: classStudents.studentName,
            role: users.role,
            openId: users.openId,
          })
          .from(classStudents)
          .innerJoin(users, eq(users.id, classStudents.studentId))
          .where(eq(classStudents.id, input.classStudentId))
          .limit(1);

        const student = studentRows[0];
        if (!student) {
          throw new TRPCError({ code: "NOT_FOUND", message: "لم يتم العثور على طالب مطابق." });
        }
        if (student.openId === ENV.ownerOpenId || student.role === "admin") {
          await logAdminAction(ctx, {
            action: "blocked_reset_admin_password",
            targetOpenId: student.openId,
            details: "محاولة إعادة تعيين كلمة مرور مالك المنصة أو حساب إداري.",
          });
        }
        assertCanResetPassword(ctx, student);

        // TODO phase 3: student class passwords are still stored as plain text in classStudents.password.
        // Keep the current schema in phase 1, then migrate student credentials to hashed storage.
        await database
          .update(classStudents)
          .set({ password: input.newPassword })
          .where(eq(classStudents.id, input.classStudentId));

        await logAdminAction(ctx, {
          action: "reset_student_access_code",
          targetOpenId: student.openId,
          details: `تمت إعادة تعيين رمز دخول الطالب في سجل الفصل رقم ${input.classStudentId}`,
        });

        return {
          success: true,
          targetType: "student" as const,
          message: "تم تحديث رمز دخول الطالب بنجاح. يُستخدم هذا الرمز لدخول الطالب إلى المنصة.",
        };
      }),

    getAllUsers: protectedProcedure.query(async ({ ctx }) => {
      const { ENV } = await import("./_core/env");
      if (ctx.user.openId !== ENV.ownerOpenId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "هذه الصفحة مخصصة لمنشئ الموقع فقط" });
      }
      const database = await getDb();
      if (!database) return [];
      return database.select().from(users).orderBy(desc(users.createdAt));
    }),

    listUsersManagement: protectedProcedure.query(async ({ ctx }) => {
      const { ENV } = await import("./_core/env");
      if (ctx.user.openId !== ENV.ownerOpenId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "هذه الصفحة مخصصة لمنشئ الموقع فقط" });
      }

      const database = await getDb();
      if (!database) return [];

      const rows = await database
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          maskedOpenId: sql<string>`CASE WHEN CHAR_LENGTH(${users.openId}) <= 10 THEN ${users.openId} ELSE CONCAT(LEFT(${users.openId}, 6), '...', RIGHT(${users.openId}, 4)) END`,
          role: users.role,
          createdAt: users.createdAt,
          updatedAt: users.updatedAt,
          lastSignedIn: users.lastSignedIn,
          isBanned: sql<number>`EXISTS(SELECT 1 FROM ${bannedUsers} bu WHERE bu.openId = ${users.openId})`,
          studentLinksCount: sql<number>`(SELECT COUNT(*) FROM ${classStudents} cs WHERE cs.studentId = ${users.id})`,
          teacherClassesCount: sql<number>`(SELECT COUNT(*) FROM ${classes} c WHERE c.teacherId = ${users.id})`,
          isOwner: sql<number>`CASE WHEN ${users.openId} = ${ENV.ownerOpenId} THEN 1 ELSE 0 END`,
        })
        .from(users)
        .orderBy(desc(users.createdAt));

      return rows.map((row) => ({
        ...row,
        isBanned: Number(row.isBanned) > 0,
        studentLinksCount: Number(row.studentLinksCount) || 0,
        teacherClassesCount: Number(row.teacherClassesCount) || 0,
        isOwner: Number(row.isOwner) > 0,
      }));
    }),

    getStats: protectedProcedure.query(async ({ ctx }) => {
      const { ENV } = await import("./_core/env");
      if (ctx.user.openId !== ENV.ownerOpenId) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const database = await getDb();
      if (!database) return { totalUsers: 0, totalClasses: 0, totalLessons: 0, totalArtworks: 0 };

      const [usersCount] = await database.select({ count: sql<number>`count(*)` }).from(users);
      const [classesCount] = await database.select({ count: sql<number>`count(*)` }).from(classes);
      const [lessonsCount] = await database.select({ count: sql<number>`count(*)` }).from(lessons);
      const [artworksCount] = await database.select({ count: sql<number>`count(*)` }).from(artworks);

      return {
        totalUsers: Number(usersCount.count) || 0,
        totalClasses: Number(classesCount.count) || 0,
        totalLessons: Number(lessonsCount.count) || 0,
        totalArtworks: Number(artworksCount.count) || 0,
      };
    }),

    getDistributions: protectedProcedure.query(async ({ ctx }) => {
      const { ENV } = await import("./_core/env");
      if (ctx.user.openId !== ENV.ownerOpenId) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      const database = await getDb();
      if (!database) {
        return {
          usersByRole: [],
          lessonsByCategory: [],
          lessonsByGrade: [],
          pathsByCategory: [],
          pathsByGrade: [],
          challengesByDifficulty: [],
          classesByGrade: [],
        };
      }

      const usersByRoleRaw = await database
        .select({ label: users.role, count: sql<number>`count(*)` })
        .from(users)
        .groupBy(users.role);

      const lessonsByCategoryRaw = await database
        .select({ label: lessons.category, count: sql<number>`count(*)` })
        .from(lessons)
        .groupBy(lessons.category);

      const lessonsByGradeRaw = await database
        .select({ label: sql<string>`coalesce(${lessons.grade}, 'غير محدد')`, count: sql<number>`count(*)` })
        .from(lessons)
        .groupBy(sql`coalesce(${lessons.grade}, 'غير محدد')`);

      const pathsByCategoryRaw = await database
        .select({ label: learningPaths.category, count: sql<number>`count(*)` })
        .from(learningPaths)
        .groupBy(learningPaths.category);

      const pathsByGradeRaw = await database
        .select({ label: sql<string>`coalesce(${learningPaths.grade}, 'غير محدد')`, count: sql<number>`count(*)` })
        .from(learningPaths)
        .groupBy(sql`coalesce(${learningPaths.grade}, 'غير محدد')`);

      const challengesByDifficultyRaw = await database
        .select({ label: challenges.difficulty, count: sql<number>`count(*)` })
        .from(challenges)
        .groupBy(challenges.difficulty);

      const classesByGradeRaw = await database
        .select({ label: classes.grade, count: sql<number>`count(*)` })
        .from(classes)
        .groupBy(classes.grade);

      const toList = (rows: Array<{ label: string | null; count: number | null }>) =>
        rows
          .map((row) => ({
            label: row.label || "غير محدد",
            count: Number(row.count) || 0,
          }))
          .sort((a, b) => b.count - a.count);

      return {
        usersByRole: toList(usersByRoleRaw as Array<{ label: string | null; count: number | null }>),
        lessonsByCategory: toList(lessonsByCategoryRaw as Array<{ label: string | null; count: number | null }>),
        lessonsByGrade: toList(lessonsByGradeRaw as Array<{ label: string | null; count: number | null }>),
        pathsByCategory: toList(pathsByCategoryRaw as Array<{ label: string | null; count: number | null }>),
        pathsByGrade: toList(pathsByGradeRaw as Array<{ label: string | null; count: number | null }>),
        challengesByDifficulty: toList(challengesByDifficultyRaw as Array<{ label: string | null; count: number | null }>),
        classesByGrade: toList(classesByGradeRaw as Array<{ label: string | null; count: number | null }>),
      };
    }),

    getGradeManagementData: protectedProcedure.query(async ({ ctx }) => {
      const { ENV } = await import("./_core/env");
      if (ctx.user.openId !== ENV.ownerOpenId) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      const database = await getDb();
      if (!database) {
        return {
          grades: ["غير محدد"],
          students: [],
          classes: [],
          lessons: [],
          paths: [],
          challenges: [],
        };
      }

      const classesData = await database.select({
        id: classes.id,
        name: classes.name,
        grade: classes.grade,
        teacherId: classes.teacherId,
      }).from(classes).orderBy(classes.grade, classes.name);

      const lessonsData = await database.select({
        id: lessons.id,
        title: lessons.title,
        grade: lessons.grade,
        category: lessons.category,
        teacherId: lessons.teacherId,
      }).from(lessons).orderBy(lessons.grade, lessons.title);

      const pathsData = await database.select({
        id: learningPaths.id,
        title: learningPaths.title,
        grade: learningPaths.grade,
        category: learningPaths.category,
        teacherId: learningPaths.teacherId,
      }).from(learningPaths).orderBy(learningPaths.grade, learningPaths.title);

      const challengesDataRaw = await database.select({
        id: challenges.id,
        title: challenges.title,
        description: challenges.description,
        difficulty: challenges.difficulty,
        teacherId: challenges.teacherId,
      }).from(challenges).orderBy(desc(challenges.createdAt));

      const studentRows = await database
        .select({
          userId: users.id,
          name: users.name,
          email: users.email,
          openId: users.openId,
          grade: classes.grade,
          className: classes.name,
        })
        .from(classStudents)
        .innerJoin(users, eq(classStudents.studentId, users.id))
        .innerJoin(classes, eq(classStudents.classId, classes.id))
        .orderBy(classes.grade, users.name);

      const giftedRows = await database
        .select({
          id: giftedStudents.id,
          studentId: giftedStudents.studentId,
          talentField: giftedStudents.talentField,
          studentName: users.name,
          grade: classes.grade,
          className: classes.name,
        })
        .from(giftedStudents)
        .innerJoin(users, eq(giftedStudents.studentId, users.id))
        .leftJoin(classStudents, eq(classStudents.studentId, giftedStudents.studentId))
        .leftJoin(classes, eq(classes.id, classStudents.classId))
        .orderBy(users.name);

      const studentUniqueMap = new Map<string, {
        userId: number;
        name: string | null;
        email: string | null;
        openId: string;
        grade: string;
        className: string;
      }>();

      for (const row of studentRows) {
        const key = `${row.userId}__${row.className}`;
        if (!studentUniqueMap.has(key)) {
          studentUniqueMap.set(key, {
            userId: row.userId,
            name: row.name,
            email: row.email,
            openId: row.openId,
            grade: row.grade,
            className: row.className,
          });
        }
      }

      const giftedUniqueMap = new Map<number, {
        id: number;
        studentId: number;
        studentName: string | null;
        talentField: string;
        grade: string;
        className: string;
      }>();

      for (const row of giftedRows) {
        if (!giftedUniqueMap.has(row.id)) {
          giftedUniqueMap.set(row.id, {
            id: row.id,
            studentId: row.studentId,
            studentName: row.studentName,
            talentField: row.talentField,
            grade: row.grade || "غير محدد",
            className: row.className || "غير محدد",
          });
        }
      }

      const gradeSet = new Set<string>();
      classesData.forEach((item) => gradeSet.add(item.grade || "غير محدد"));
      lessonsData.forEach((item) => gradeSet.add(item.grade || "غير محدد"));
      pathsData.forEach((item) => gradeSet.add(item.grade || "غير محدد"));
      Array.from(studentUniqueMap.values()).forEach((item) => gradeSet.add(item.grade || "غير محدد"));

      const knownGrades = Array.from(gradeSet).filter(Boolean);

      const mapChallengeGrade = (title: string, description?: string | null) => {
        const text = `${title} ${description || ""}`;
        const match = knownGrades.find((grade) => grade !== "غير محدد" && text.includes(grade));
        return match || "غير محدد";
      };

      const challengesData = challengesDataRaw.map((item) => ({
        id: item.id,
        title: item.title,
        difficulty: item.difficulty || "medium",
        teacherId: item.teacherId,
        grade: mapChallengeGrade(item.title, item.description),
      }));

      const grades = Array.from(new Set([...knownGrades, ...challengesData.map((c) => c.grade), "غير محدد"]))
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b, "ar"));

      return {
        grades,
        students: Array.from(studentUniqueMap.values()),
        gifted: Array.from(giftedUniqueMap.values()),
        classes: classesData.map((item) => ({ ...item, grade: item.grade || "غير محدد" })),
        lessons: lessonsData.map((item) => ({ ...item, grade: item.grade || "غير محدد" })),
        paths: pathsData.map((item) => ({ ...item, grade: item.grade || "غير محدد" })),
        challenges: challengesData,
      };
    }),

    uploadAndAnalyzePdf: protectedProcedure
      .input(
        z.object({
          pdfData: z.string().min(1),
          fileName: z.string().min(1),
          mimeType: z.string().optional(),
          grade: z.string().min(1).max(100),
          subject: z.string().min(1).max(255),
          title: z.string().max(255).optional(),
          dryRun: z.boolean().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({ code: "UNAUTHORIZED" });
        }

        const { ENV } = await import("./_core/env");
        if (ctx.user.openId !== ENV.ownerOpenId) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }

        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        try {
          const decodedFileName = decodeMojibakeArabicFileName(input.fileName);
          const result = await createAndAnalyzePdfImportJob({
            database,
            createdBy: ctx.user.id,
            fileName: decodedFileName,
            mimeType: input.mimeType,
            grade: input.grade,
            subject: input.subject,
            title: input.title,
            buffer: pdfDataUrlToBuffer(input.pdfData),
          });

          return {
            ...result,
            dryRun: input.dryRun ?? true,
          };
        } catch (error) {
          if (error instanceof PdfImportInputError) {
            throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
          }

          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "تعذر تحليل ملف PDF وإنشاء المعاينة",
          });
        }
      }),

    getImportJobPreview: protectedProcedure
      .input(z.object({ jobId: z.number().int().positive() }))
      .query(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({ code: "UNAUTHORIZED" });
        }

        const { ENV } = await import("./_core/env");
        if (ctx.user.openId !== ENV.ownerOpenId) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }

        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const rows = await database
          .select()
          .from(contentImportJobs)
          .where(eq(contentImportJobs.id, input.jobId))
          .limit(1);

        if (!rows[0]) {
          throw new TRPCError({ code: "NOT_FOUND", message: "لم يتم العثور على عملية الاستيراد" });
        }

        let preview: unknown = null;
        if (rows[0].previewPayload) {
          try {
            preview = JSON.parse(rows[0].previewPayload);
            if (preview && typeof preview === "object") {
              const mutable = preview as Record<string, any>;
              applyMergedLessonState(mutable);
              mutable.summary = recomputePreviewSummary(mutable);
              if (mutable.meta && typeof mutable.meta === "object") {
                mutable.meta.fileName = resolveDisplayImportFileName(String(mutable.meta.fileName || rows[0].fileName || ""), rows[0].title);
                if (!mutable.meta.title) {
                  mutable.meta.title = mutable.meta.fileName;
                }
              }
            }
          } catch {
            preview = null;
          }
        }

        const displayFileName = resolveDisplayImportFileName(rows[0].fileName, rows[0].title);
        return {
          ...rows[0],
          fileName: displayFileName,
          preview,
        };
      }),

    saveImportJobPreviewOverrides: protectedProcedure
      .input(
        z.object({
          jobId: z.number().int().positive(),
          preview: z.any(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({ code: "UNAUTHORIZED" });
        }

        const { ENV } = await import("./_core/env");
        if (ctx.user.openId !== ENV.ownerOpenId) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }

        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const rows = await database
          .select()
          .from(contentImportJobs)
          .where(eq(contentImportJobs.id, input.jobId))
          .limit(1);

        const job = rows[0];
        if (!job) {
          throw new TRPCError({ code: "NOT_FOUND", message: "لم يتم العثور على عملية الاستيراد" });
        }

        if (!job.previewPayload) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "لا توجد معاينة لتعديلها" });
        }

        if (!input.preview || typeof input.preview !== "object") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "بيانات المعاينة غير صالحة" });
        }

        const normalizedPreview = normalizePreviewForOverrides(input.preview);
        normalizedPreview.meta = {
          ...(normalizedPreview.meta || {}),
          fileName: resolveDisplayImportFileName(
            String(normalizedPreview?.meta?.fileName || job.fileName || ""),
            job.title
          ),
          title: normalizedPreview?.meta?.title || job.title || job.fileName,
          analysis: {
            ...(normalizedPreview?.meta?.analysis || {}),
            previewOverrides: {
              applied: true,
              updatedAt: new Date().toISOString(),
              updatedByUserId: ctx.user.id,
              overrideMode: "quick_fix_editor",
            },
          },
        };

        const warnings = Array.isArray(normalizedPreview.warnings) ? normalizedPreview.warnings : [];
        if (!warnings.includes("preview_overrides_applied")) {
          normalizedPreview.warnings = [...warnings, "preview_overrides_applied"];
        }

        await database
          .update(contentImportJobs)
          .set({
            previewPayload: buildStorablePreviewPayload(normalizedPreview),
            extractedPathsCount: normalizedPreview.summary?.pathsCount ?? 0,
            extractedLessonsCount: normalizedPreview.summary?.lessonsCount ?? 0,
            extractedChallengesCount: normalizedPreview.summary?.challengesCount ?? 0,
            extractedQuizzesCount: normalizedPreview.summary?.quizzesCount ?? 0,
            status: job.status === "uploaded" || job.status === "analyzing" ? "preview_ready" : job.status,
          })
          .where(eq(contentImportJobs.id, input.jobId));

        return {
          success: true,
          jobId: input.jobId,
          preview: normalizedPreview,
          summary: normalizedPreview.summary,
        };
      }),

    approveImportJob: protectedProcedure
      .input(
        z.object({
          jobId: z.number().int().positive(),
          dryRun: z.boolean().optional(),
          confirmManualReview: z.boolean().optional(),
          force: z.boolean().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({ code: "UNAUTHORIZED" });
        }

        const { ENV } = await import("./_core/env");
        if (ctx.user.openId !== ENV.ownerOpenId) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }

        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const rows = await database
          .select()
          .from(contentImportJobs)
          .where(eq(contentImportJobs.id, input.jobId))
          .limit(1);

        const job = rows[0];
        if (!job) {
          throw new TRPCError({ code: "NOT_FOUND", message: "لم يتم العثور على عملية الاستيراد" });
        }

        if (!job.previewPayload) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "لا توجد معاينة متاحة لاعتمادها" });
        }

        let preview: any;
        try {
          preview = JSON.parse(job.previewPayload);
        } catch {
          throw new TRPCError({ code: "BAD_REQUEST", message: "بيانات المعاينة غير صالحة" });
        }

        if (preview?.mode === "ocr_required") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "الملف يحتاج OCR قبل اعتماد الاستيراد.",
          });
        }

        if (preview?.mode === "fallback_split" && !input.dryRun) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "وضع fallback_split غير مسموح للاعتماد النهائي. استخدم dry-run أو أعد التحليل.",
          });
        }

        const forceRequested = Boolean(input.force);
        const isReviewRequired = preview?.mode === "review_required";
        const forceAllowedInEnv = (process.env.PDF_REVIEW_FORCE_OVERRIDE_ENABLED || "false").toLowerCase() === "true";
        const canUseForceOverride = process.env.NODE_ENV !== "production" || forceAllowedInEnv;
        const forceOverrideApplied = forceRequested && isReviewRequired && !input.dryRun;

        if (forceRequested && !canUseForceOverride) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "force override معطل في بيئة الإنتاج الحالية.",
          });
        }

        if (isReviewRequired && !input.dryRun && !input.confirmManualReview && !forceOverrideApplied) {
          const rejectReasons: string[] = Array.isArray(preview?.meta?.analysis?.structuredRejectReasons)
            ? preview.meta.analysis.structuredRejectReasons
            : [];
          const reasonText = rejectReasons.length
            ? `الأسباب: ${rejectReasons.join(", ")}`
            : "الأسباب غير متوفرة، راجع المعاينة قبل الاعتماد.";

          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `هذا الملف في وضع review_required ويتطلب تأكيد مراجعة بشرية قبل الإنشاء النهائي. ${reasonText}`,
          });
        }

        if (forceOverrideApplied) {
          const nowIso = new Date().toISOString();
          const existingOverrides: Array<Record<string, unknown>> = Array.isArray(preview?.meta?.analysis?.reviewOverrideHistory)
            ? preview.meta.analysis.reviewOverrideHistory
            : [];

          const overrideRecord = {
            type: "review_required_force_override_test",
            forcedAt: nowIso,
            forcedByUserId: ctx.user.id,
            forceFlag: true,
            testOnly: true,
          };

          preview = {
            ...preview,
            meta: {
              ...(preview?.meta || {}),
              analysis: {
                ...(preview?.meta?.analysis || {}),
                reviewOverrideApplied: true,
                reviewOverrideHistory: [...existingOverrides, overrideRecord],
              },
            },
          };

          await database
            .update(contentImportJobs)
            .set({
              previewPayload: buildStorablePreviewPayload(preview),
              errorMessage: "test_override_applied: review_required_force_override",
            })
            .where(eq(contentImportJobs.id, input.jobId));
        }

        if (!input.dryRun) {
          await database
            .update(contentImportJobs)
            .set({
              status: "approved",
              errorMessage: forceOverrideApplied
                ? "test_override_applied: review_required_force_override"
                : null,
            })
            .where(eq(contentImportJobs.id, input.jobId));
        }

        try {
          const imported = await importFromApprovedPreview({
            database,
            preview,
            importJobId: input.jobId,
            createdBy: ctx.user.id,
            sourceFileName: job.fileName,
            dryRun: input.dryRun ?? false,
          });

          let autoBuilderSummary: {
            pathsCreated: number;
            lessonsObjectiveUpdated: number;
            challengesCreated: number;
            quizzesCreated: number;
          } | null = null;

          if (!input.dryRun) {
            try {
              autoBuilderSummary = await runAutoCurriculumBuilder({
                database,
                preview,
                importJobId: input.jobId,
                createdBy: ctx.user.id,
                sourceFileName: job.fileName,
              });
            } catch (builderError) {
              imported.warnings.push(
                `auto_curriculum_builder_failed: ${
                  builderError instanceof Error ? builderError.message : "unknown_error"
                }`
              );
            }
          }

          if (!input.dryRun) {
            const autoBuilderNote = autoBuilderSummary
              ? `auto_builder(paths:${autoBuilderSummary.pathsCreated}, objectives:${autoBuilderSummary.lessonsObjectiveUpdated}, challenges:${autoBuilderSummary.challengesCreated}, quizzes:${autoBuilderSummary.quizzesCreated})`
              : null;
            const warningsText = imported.warnings.length ? imported.warnings.slice(0, 8).join(" | ") : null;
            await database
              .update(contentImportJobs)
              .set({
                status: "imported",
                extractedPathsCount: preview.summary?.pathsCount || 0,
                extractedLessonsCount: preview.summary?.lessonsCount || 0,
                extractedChallengesCount: preview.summary?.challengesCount || 0,
                extractedQuizzesCount: preview.summary?.quizzesCount || 0,
                errorMessage: [warningsText, autoBuilderNote].filter(Boolean).join(" | ") || null,
              })
              .where(eq(contentImportJobs.id, input.jobId));
          }

          return {
            success: true,
            dryRun: input.dryRun ?? false,
            jobId: input.jobId,
            mode: preview?.mode || "unknown",
            forceOverrideApplied,
            policy: {
              autoCreateAllowed: preview?.mode === "structured",
              manualReviewRequired: preview?.mode === "review_required",
              blockedForOcr: preview?.mode === "ocr_required",
              blockedForFallback: preview?.mode === "fallback_split",
              forceOverrideTestOnly: Boolean(forceRequested),
            },
            counters: imported.counters,
            warnings: imported.warnings,
            autoCurriculumBuilder: autoBuilderSummary,
          };
        } catch (error) {
          if (!input.dryRun) {
            await database
              .update(contentImportJobs)
              .set({
                status: "failed",
                errorMessage: error instanceof Error ? error.message.slice(0, 2000) : "فشل اعتماد الاستيراد",
              })
              .where(eq(contentImportJobs.id, input.jobId));
          }

          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "تعذر اعتماد المعاينة وإنشاء المحتوى",
          });
        }
      }),

    listImportJobs: protectedProcedure
      .input(z.object({ limit: z.number().int().min(1).max(100).optional() }).optional())
      .query(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({ code: "UNAUTHORIZED" });
        }

        const { ENV } = await import("./_core/env");
        if (ctx.user.openId !== ENV.ownerOpenId) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }

        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const limit = input?.limit || 20;
        const rows = await database
          .select({
            id: contentImportJobs.id,
            fileName: contentImportJobs.fileName,
            storageKey: contentImportJobs.storageKey,
            grade: contentImportJobs.grade,
            subject: contentImportJobs.subject,
            title: contentImportJobs.title,
            status: contentImportJobs.status,
            pageCount: contentImportJobs.pageCount,
            extractedPathsCount: contentImportJobs.extractedPathsCount,
            extractedLessonsCount: contentImportJobs.extractedLessonsCount,
            extractedChallengesCount: contentImportJobs.extractedChallengesCount,
            extractedQuizzesCount: contentImportJobs.extractedQuizzesCount,
            errorMessage: contentImportJobs.errorMessage,
            createdAt: contentImportJobs.createdAt,
            updatedAt: contentImportJobs.updatedAt,
          })
          .from(contentImportJobs)
          .orderBy(desc(contentImportJobs.createdAt))
          .limit(limit);

        return rows.map((row) => ({
          ...row,
          fileName: resolveDisplayImportFileName(row.fileName, row.title),
        }));
      }),

    deleteImportJob: protectedProcedure
      .input(
        z.object({
          jobId: z.number().int().positive(),
          deleteFromStorage: z.boolean().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({ code: "UNAUTHORIZED" });
        }

        const { ENV } = await import("./_core/env");
        if (ctx.user.openId !== ENV.ownerOpenId) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }

        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const rows = await database
          .select({
            id: contentImportJobs.id,
            fileName: contentImportJobs.fileName,
            storageKey: contentImportJobs.storageKey,
            status: contentImportJobs.status,
          })
          .from(contentImportJobs)
          .where(eq(contentImportJobs.id, input.jobId))
          .limit(1);

        const job = rows[0];
        if (!job) {
          throw new TRPCError({ code: "NOT_FOUND", message: "لم يتم العثور على عملية الاستيراد" });
        }

        const deleteFromStorage = input.deleteFromStorage ?? true;
        let storageDeleted = false;
        let storageDeleteError: string | null = null;

        if (deleteFromStorage && job.storageKey) {
          try {
            await storageDelete(job.storageKey);
            storageDeleted = true;
          } catch (error) {
            storageDeleteError = error instanceof Error ? error.message : "فشل حذف الملف من التخزين";
          }
        }

        await database.delete(contentSourceRecords).where(eq(contentSourceRecords.importJobId, input.jobId));
        await database.delete(contentImportJobs).where(eq(contentImportJobs.id, input.jobId));

        return {
          success: true,
          jobId: input.jobId,
          status: job.status,
          fileName: resolveDisplayImportFileName(job.fileName, null),
          storageDeleted,
          storageDeleteError,
        };
      }),

    runMaintenanceScript: protectedProcedure
      .input(z.object({
        task: z.enum([
          "curriculum-clean",
          "curriculum-verify",
          "curriculum-build",
          "curriculum-full-refresh",
          "curriculum-sync-no-duplicates",
          "curriculum-sync-dry-run",
          "import-spaces",
          "upload-spaces",
          "seed-quizzes-all",
          "quizzes-dedupe",
          "tests-external-links-report",
          "tests-conflicts-report",
          "tests-coverage-report",
          "seed-challenges",
          "challenges-duplicates-report",
          "videos-map-dry-run",
          "videos-export-map",
          "videos-links-report",
          "preview-distributions",
          "preview-enriched",
          "lessons-duplicates-report",
          "lessons-repair-links",
          "curriculum-repair-pages",
          "pages-preview-source",
          "quality-integrity-report",
          "quality-content-report",
          "quality-gaps-report",
          "safe-clean-orphans",
          "safe-backfill-source-tags",
          "reports-status-preview",
          "reports-summary",
          "reports-before-after",
        ]),
      }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({ code: "UNAUTHORIZED" });
        }

        const { ENV } = await import("./_core/env");
        if (ctx.user.openId !== ENV.ownerOpenId) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }

        const executionShell = process.platform === "win32"
          ? process.env.ComSpec || "cmd.exe"
          : "/bin/sh";

        const supportedTasks = new Set(listMaintenanceTasks());
        if (!supportedTasks.has(input.task as RunnerMaintenanceTask)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "المهمة المطلوبة غير مدعومة حاليًا",
          });
        }

        const command = buildMaintenanceCommand(input.task as RunnerMaintenanceTask);
        const job = startMaintenanceJob({
          task: input.task as RunnerMaintenanceTask,
          command,
          cwd: process.cwd(),
          shell: executionShell,
          onSuccess: async () => {
            await logAdminAction(ctx, {
              action: "run_maintenance_script",
              details: `task=${input.task}`,
            });
          },
          onFailure: async () => {
            await logAdminAction(ctx, {
              action: "run_maintenance_script_failed",
              details: `task=${input.task}`,
            });
          },
        });

        return {
          success: true,
          task: input.task,
          jobId: job.id,
          status: job.status,
          output: "",
          message: "تم بدء تنفيذ المهمة في الخلفية. تابع النتيجة من حالة التنفيذ.",
        };
      }),

    getMaintenanceScriptStatus: protectedProcedure
      .input(z.object({ jobId: z.string().min(1) }))
      .query(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({ code: "UNAUTHORIZED" });
        }

        const { ENV } = await import("./_core/env");
        if (ctx.user.openId !== ENV.ownerOpenId) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }

        const job = getMaintenanceJob(input.jobId);
        if (!job) {
          // Avoid query-level 404/207 in polling batches when the in-memory runner
          // state is lost (e.g. after process restart). Return a terminal failed
          // status so the client can stop polling gracefully.
          return {
            success: false,
            id: input.jobId,
            status: "failed" as const,
            output: "",
            errorMessage: "تعذر العثور على سجل المهمة. ربما تمت إعادة تشغيل الخادم أثناء التنفيذ.",
            finishedAt: new Date().toISOString(),
          };
        }

        return {
          success: true,
          ...job,
        };
      }),

    getSiteGallerySettings: protectedProcedure.query(async ({ ctx }) => {
      const { ENV } = await import("./_core/env");
      if (ctx.user.openId !== ENV.ownerOpenId) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      const database = await getDb();
      if (!database) {
        return DEFAULT_SITE_GALLERY_SETTINGS;
      }

      let rows: any[] = [];
      try {
        rows = await database
          .select()
          .from(siteGallerySettings)
          .where(eq(siteGallerySettings.id, 1))
          .limit(1);
      } catch (error) {
        if (!isMissingGallerySettingsSchemaError(error)) throw error;
        return DEFAULT_SITE_GALLERY_SETTINGS;
      }

      const row = rows[0];
      if (!row) return DEFAULT_SITE_GALLERY_SETTINGS;

      return {
        id: 1,
        heroTitle: row.heroTitle || DEFAULT_SITE_GALLERY_SETTINGS.heroTitle,
        heroDescription: row.heroDescription || DEFAULT_SITE_GALLERY_SETTINGS.heroDescription,
        heroBadge: row.heroBadge || DEFAULT_SITE_GALLERY_SETTINGS.heroBadge,
        heroImageUrl: row.heroImageUrl || "",
        updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : null,
        categories: parseStringArrayJson(row.categoriesJson, DEFAULT_SITE_GALLERY_SETTINGS.categories),
        emptyTitle: row.emptyTitle || DEFAULT_SITE_GALLERY_SETTINGS.emptyTitle,
        emptyDescription: row.emptyDescription || DEFAULT_SITE_GALLERY_SETTINGS.emptyDescription,
        imageErrorTitle: row.imageErrorTitle || DEFAULT_SITE_GALLERY_SETTINGS.imageErrorTitle,
        imageErrorDescription: row.imageErrorDescription || DEFAULT_SITE_GALLERY_SETTINGS.imageErrorDescription,
        slideshowEnabled:
          typeof row.slideshowEnabled === "undefined"
            ? DEFAULT_SITE_GALLERY_SETTINGS.slideshowEnabled
            : Boolean(row.slideshowEnabled),
        slideshowIntervalSeconds: normalizeSlideshowIntervalSeconds(
          row.slideshowIntervalSeconds,
          DEFAULT_SITE_GALLERY_SETTINGS.slideshowIntervalSeconds,
        ),
        slideshowShowDetails:
          typeof row.slideshowShowDetails === "undefined"
            ? DEFAULT_SITE_GALLERY_SETTINGS.slideshowShowDetails
            : Boolean(row.slideshowShowDetails),
      };
    }),

    uploadSiteGalleryImage: protectedProcedure
      .input(
        z.object({
          imageData: z.string().min(1),
          fileName: z.string().min(1).optional(),
          mimeType: z.string().min(1).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { ENV } = await import("./_core/env");
        if (ctx.user.openId !== ENV.ownerOpenId) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }

        const mimeType = input.mimeType || "image/png";
        if (!mimeType.startsWith("image/")) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "نوع الملف غير مدعوم" });
        }

        const cleanedBase64 = input.imageData.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, "");
        const buffer = Buffer.from(cleanedBase64, "base64");
        if (!buffer.length) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "بيانات الصورة غير صالحة" });
        }
        if (buffer.length > 8 * 1024 * 1024) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "حجم الصورة يجب ألا يتجاوز 8MB" });
        }

        const extension = mimeType.split("/")[1] || "png";
        const safeName = (input.fileName || "site-gallery-hero")
          .replace(/\.[^/.]+$/, "")
          .replace(/[^a-zA-Z0-9-_]/g, "-")
          .slice(0, 64);

        const uploaded = await storagePut(`gallery/site/${safeName}.${extension}`, buffer, mimeType);

        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        await registerInternalAsset(database, {
          provider: "spaces",
          bucket: uploaded.bucket,
          objectKey: uploaded.key,
          publicUrl: uploaded.url,
          mimeType,
          fileSize: buffer.length,
          sourceType: "site_gallery_image_upload",
          ownershipContext: "site_gallery",
        });

        return {
          success: true,
          url: uploaded.url,
          key: uploaded.key,
          bucket: uploaded.bucket,
        };
      }),

    updateSiteGallerySettings: protectedProcedure
      .input(
        z.object({
          heroTitle: z.string().min(3).max(255),
          heroDescription: z.string().min(3).max(5000),
          heroBadge: z.string().min(1).max(255),
          heroImageUrl: z.string().max(5000).optional(),
          categories: z.array(z.string().min(1).max(64)).min(1).max(20),
          emptyTitle: z.string().min(3).max(255),
          emptyDescription: z.string().min(3).max(5000),
          imageErrorTitle: z.string().min(3).max(255),
          imageErrorDescription: z.string().min(3).max(5000),
          slideshowEnabled: z.boolean().default(true),
          slideshowIntervalSeconds: z.number().int().min(3).max(15).default(5),
          slideshowShowDetails: z.boolean().default(false),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { ENV } = await import("./_core/env");
        if (ctx.user.openId !== ENV.ownerOpenId) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }

        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const normalizedCategories = Array.from(
          new Set(input.categories.map((value) => String(value || "").trim()).filter((value) => value.length > 0))
        );

        const payload = {
          id: 1,
          heroTitle: input.heroTitle.trim(),
          heroDescription: input.heroDescription.trim(),
          heroBadge: input.heroBadge.trim(),
          heroImageUrl: String(input.heroImageUrl || "").trim(),
          categoriesJson: JSON.stringify(normalizedCategories),
          emptyTitle: input.emptyTitle.trim(),
          emptyDescription: input.emptyDescription.trim(),
          imageErrorTitle: input.imageErrorTitle.trim(),
          imageErrorDescription: input.imageErrorDescription.trim(),
          slideshowEnabled: input.slideshowEnabled,
          slideshowIntervalSeconds: normalizeSlideshowIntervalSeconds(input.slideshowIntervalSeconds),
          slideshowShowDetails: input.slideshowShowDetails,
          updatedAt: new Date(),
        };

        try {
          await database
            .insert(siteGallerySettings)
            .values(payload)
            .onDuplicateKeyUpdate({
              set: {
                heroTitle: payload.heroTitle,
                heroDescription: payload.heroDescription,
                heroBadge: payload.heroBadge,
                heroImageUrl: payload.heroImageUrl,
                categoriesJson: payload.categoriesJson,
                emptyTitle: payload.emptyTitle,
                emptyDescription: payload.emptyDescription,
                imageErrorTitle: payload.imageErrorTitle,
                imageErrorDescription: payload.imageErrorDescription,
                slideshowEnabled: payload.slideshowEnabled,
                slideshowIntervalSeconds: payload.slideshowIntervalSeconds,
                slideshowShowDetails: payload.slideshowShowDetails,
                updatedAt: new Date(),
              },
            });
        } catch (error) {
          if (!isMissingGallerySettingsSchemaError(error)) throw error;

          const legacyPayload = withoutGallerySlideshowFields(payload);
          await database
            .insert(siteGallerySettings)
            .values(legacyPayload as any)
            .onDuplicateKeyUpdate({
              set: {
                heroTitle: payload.heroTitle,
                heroDescription: payload.heroDescription,
                heroBadge: payload.heroBadge,
                heroImageUrl: payload.heroImageUrl,
                categoriesJson: payload.categoriesJson,
                emptyTitle: payload.emptyTitle,
                emptyDescription: payload.emptyDescription,
                imageErrorTitle: payload.imageErrorTitle,
                imageErrorDescription: payload.imageErrorDescription,
                updatedAt: new Date(),
              } as any,
            });
        }

        return { success: true };
      }),

    getAboutSettings: protectedProcedure.query(async ({ ctx }) => {
      const { ENV } = await import("./_core/env");
      if (ctx.user.openId !== ENV.ownerOpenId) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      const database = await getDb();
      if (!database) {
        return DEFAULT_ABOUT_SETTINGS;
      }

      try {
        const rows = await database
          .select()
          .from(aboutPageSettings)
          .orderBy(desc(aboutPageSettings.id))
          .limit(1);

        if (!rows[0]) {
          return DEFAULT_ABOUT_SETTINGS;
        }

        return {
          heroTitle: rows[0].heroTitle,
          heroDescription: rows[0].heroDescription,
          mediaType: rows[0].mediaType || "video",
          mediaUrl: rows[0].mediaUrl,
          mediaTitle: rows[0].mediaTitle,
          mediaDescription: rows[0].mediaDescription || "",
        };
      } catch {
        return DEFAULT_ABOUT_SETTINGS;
      }
    }),

    uploadAboutImage: protectedProcedure
      .input(
        z.object({
          imageData: z.string().min(1),
          fileName: z.string().min(1).optional(),
          mimeType: z.string().min(1).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { ENV } = await import("./_core/env");
        if (ctx.user.openId !== ENV.ownerOpenId) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }

        const mimeType = input.mimeType || "image/png";
        if (!mimeType.startsWith("image/")) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "نوع الملف غير مدعوم" });
        }

        const cleanedBase64 = input.imageData.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, "");
        const buffer = Buffer.from(cleanedBase64, "base64");

        if (!buffer.length) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "بيانات الصورة غير صالحة" });
        }

        if (buffer.length > 8 * 1024 * 1024) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "حجم الصورة يجب ألا يتجاوز 8MB" });
        }

        const extension = mimeType.split("/")[1] || "png";
        const safeName = (input.fileName || "about-image")
          .replace(/\.[^/.]+$/, "")
          .replace(/[^a-zA-Z0-9-_]/g, "-")
          .slice(0, 50);

        const originalName = `about/${safeName}.${extension}`;
        const uploaded = await storagePut(originalName, buffer, mimeType);

        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const assetId = await registerInternalAsset(database, {
          provider: "spaces",
          bucket: uploaded.bucket,
          objectKey: uploaded.key,
          publicUrl: uploaded.url,
          mimeType,
          fileSize: buffer.length,
          sourceType: "about_image_upload",
          ownershipContext: "about",
        });

        await logAdminAction(ctx, {
          action: "upload_about_image",
          details: uploaded.key,
        });

        return {
          success: true,
          url: uploaded.url,
          key: uploaded.key,
          bucket: uploaded.bucket,
          assetId,
        };
      }),

    updateAboutSettings: protectedProcedure
      .input(z.object({
        heroTitle: z.string().min(3).max(255),
        heroDescription: z.string().min(10).max(5000),
        mediaType: z.enum(["video", "image"]),
        mediaUrl: z.string().max(5000),
        mediaTitle: z.string().min(3).max(255),
        mediaDescription: z.string().max(5000).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { ENV } = await import("./_core/env");
        if (ctx.user.openId !== ENV.ownerOpenId) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }

        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const rawMediaUrl = input.mediaUrl;
        const trimmedMediaUrl = rawMediaUrl.trim();
        console.log("[Admin][About] updateAboutSettings mediaUrl received:", rawMediaUrl);

        if (trimmedMediaUrl) {
          let parsedMediaUrl: URL;
          try {
            parsedMediaUrl = new URL(trimmedMediaUrl);
          } catch {
            throw new TRPCError({ code: "BAD_REQUEST", message: "mediaUrl must be a valid absolute URL" });
          }

          if (parsedMediaUrl.protocol !== "https:") {
            throw new TRPCError({ code: "BAD_REQUEST", message: "mediaUrl must start with https://" });
          }

          console.log("[Admin][About] mediaUrl https check passed:", trimmedMediaUrl.startsWith("https://"));
        }

        const existing = await database
          .select({ id: aboutPageSettings.id })
          .from(aboutPageSettings)
          .orderBy(desc(aboutPageSettings.id))
          .limit(1);

        const payload = {
          heroTitle: input.heroTitle.trim(),
          heroDescription: input.heroDescription.trim(),
          mediaType: input.mediaType,
          mediaUrl: trimmedMediaUrl,
          mediaTitle: input.mediaTitle.trim(),
          mediaDescription: input.mediaDescription?.trim() || "",
        };

        let aboutSettingId = Number(existing[0]?.id || 0);

        if (existing[0]) {
          await database
            .update(aboutPageSettings)
            .set(payload)
            .where(eq(aboutPageSettings.id, existing[0].id));
        } else {
          const inserted: any = await database.insert(aboutPageSettings).values(payload);
          aboutSettingId = Number(inserted?.insertId || inserted?.[0]?.insertId || 0);
        }

        if (!aboutSettingId) {
          const latest = await database
            .select({ id: aboutPageSettings.id })
            .from(aboutPageSettings)
            .orderBy(desc(aboutPageSettings.id))
            .limit(1);
          aboutSettingId = Number(latest[0]?.id || 0);
        }

        if (aboutSettingId > 0) {
          if (payload.mediaUrl) {
            await syncAboutMediaReference(database, aboutSettingId, payload.mediaUrl);
          } else {
            await detachEntityAssetReferences(database, {
              entityType: "aboutPageSettings",
              entityId: aboutSettingId,
            });
          }
        }

        await logAdminAction(ctx, {
          action: "update_about_settings",
          details: `mediaType=${payload.mediaType}`,
        });

        return { success: true };
      }),

    removeAboutImage: protectedProcedure.mutation(async ({ ctx }) => {
      const { ENV } = await import("./_core/env");
      if (ctx.user.openId !== ENV.ownerOpenId) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      const database = await getDb();
      if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const existing = await database
        .select()
        .from(aboutPageSettings)
        .orderBy(desc(aboutPageSettings.id))
        .limit(1);

      if (existing[0]) {
        await detachEntityAssetReferences(database, {
          entityType: "aboutPageSettings",
          entityId: Number(existing[0].id),
        });

        await database
          .update(aboutPageSettings)
          .set({
            mediaType: "image",
            mediaUrl: "",
          })
          .where(eq(aboutPageSettings.id, existing[0].id));
      } else {
        await database.insert(aboutPageSettings).values(DEFAULT_ABOUT_SETTINGS);
      }

      await logAdminAction(ctx, {
        action: "remove_about_image",
        details: "clear_about_media",
      });
      return { success: true };
    }),

    resetAboutSettings: protectedProcedure.mutation(async ({ ctx }) => {
      const { ENV } = await import("./_core/env");
      if (ctx.user.openId !== ENV.ownerOpenId) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      const database = await getDb();
      if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const existing = await database
        .select({ id: aboutPageSettings.id })
        .from(aboutPageSettings)
        .orderBy(desc(aboutPageSettings.id))
        .limit(1);

      if (existing[0]) {
        await detachEntityAssetReferences(database, {
          entityType: "aboutPageSettings",
          entityId: Number(existing[0].id),
        });

        await database
          .update(aboutPageSettings)
          .set(DEFAULT_ABOUT_SETTINGS)
          .where(eq(aboutPageSettings.id, existing[0].id));
      } else {
        await database.insert(aboutPageSettings).values(DEFAULT_ABOUT_SETTINGS);
      }

      await logAdminAction(ctx, {
        action: "reset_about_settings",
        details: "reset_to_defaults",
      });
      return { success: true };
    }),

    updateShowcaseSettings: protectedProcedure
      .input(
        z.object({
          heroTitle: z.string().min(3).max(255),
          heroDescription: z.string().min(10).max(5000),
          badgeLabel: z.string().min(1).max(255),
          closingNote: z.string().min(10).max(5000),
          journeySteps: z
            .array(
              z.object({
                key: z.string().min(1).max(100),
                title: z.string().min(1).max(255),
                description: z.string().min(1).max(5000),
              })
            )
            .min(1)
            .max(12),
          componentCards: z
            .array(
              z.object({
                key: z.string().min(1).max(100),
                title: z.string().min(1).max(255),
                description: z.string().min(1).max(5000),
                action: z.string().min(1).max(255),
              })
            )
            .min(1)
            .max(16),
          impactPoints: z.array(z.string().min(1).max(255)).min(1).max(16),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { ENV } = await import("./_core/env");
        if (ctx.user.openId !== ENV.ownerOpenId) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }

        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const payload = {
          id: 1,
          ...serializeShowcaseSettings({
            heroTitle: input.heroTitle.trim(),
            heroDescription: input.heroDescription.trim(),
            badgeLabel: input.badgeLabel.trim(),
            closingNote: input.closingNote.trim(),
            journeySteps: input.journeySteps.map((step) => ({
              key: step.key.trim(),
              title: step.title.trim(),
              description: step.description.trim(),
            })),
            componentCards: input.componentCards.map((card) => ({
              key: card.key.trim(),
              title: card.title.trim(),
              description: card.description.trim(),
              action: card.action.trim(),
            })),
            impactPoints: input.impactPoints.map((point) => point.trim()).filter((point) => point.length > 0),
          }),
          updatedAt: new Date(),
        };

        await database
          .insert(showcaseSettings)
          .values(payload)
          .onDuplicateKeyUpdate({
            set: {
              ...serializeShowcaseSettings({
                heroTitle: input.heroTitle.trim(),
                heroDescription: input.heroDescription.trim(),
                badgeLabel: input.badgeLabel.trim(),
                closingNote: input.closingNote.trim(),
                journeySteps: input.journeySteps.map((step) => ({
                  key: step.key.trim(),
                  title: step.title.trim(),
                  description: step.description.trim(),
                })),
                componentCards: input.componentCards.map((card) => ({
                  key: card.key.trim(),
                  title: card.title.trim(),
                  description: card.description.trim(),
                  action: card.action.trim(),
                })),
                impactPoints: input.impactPoints.map((point) => point.trim()).filter((point) => point.length > 0),
              }),
              updatedAt: new Date(),
            },
          });

        await logAdminAction(ctx, {
          action: "update_showcase_settings",
          details: "تم تحديث إعدادات العرض التنفيذي",
        });

        return { success: true };
      }),

    resetShowcaseSettings: protectedProcedure.mutation(async ({ ctx }) => {
      const { ENV } = await import("./_core/env");
      if (ctx.user.openId !== ENV.ownerOpenId) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      const database = await getDb();
      if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      await database
        .insert(showcaseSettings)
        .values({
          id: 1,
          ...serializeShowcaseSettings(DEFAULT_SHOWCASE_SETTINGS),
          updatedAt: new Date(),
        })
        .onDuplicateKeyUpdate({
          set: {
            ...serializeShowcaseSettings(DEFAULT_SHOWCASE_SETTINGS),
            updatedAt: new Date(),
          },
        });

      await logAdminAction(ctx, {
        action: "reset_showcase_settings",
        details: "reset_to_default_showcase_settings",
      });
      return { success: true };
    }),

    getBannedUsers: protectedProcedure.query(async ({ ctx }) => {
      const { ENV } = await import("./_core/env");
      if (ctx.user.openId !== ENV.ownerOpenId) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const database = await getDb();
      if (!database) return [];

      const rows = await database
        .select({
          id: bannedUsers.id,
          userId: users.id,
          name: users.name,
          email: users.email,
          maskedOpenId: sql<string>`CASE WHEN CHAR_LENGTH(${bannedUsers.openId}) <= 10 THEN ${bannedUsers.openId} ELSE CONCAT(LEFT(${bannedUsers.openId}, 6), '...', RIGHT(${bannedUsers.openId}, 4)) END`,
          reason: bannedUsers.reason,
          bannedAt: bannedUsers.bannedAt,
        })
        .from(bannedUsers)
        .leftJoin(users, eq(bannedUsers.openId, users.openId))
        .orderBy(desc(bannedUsers.bannedAt));

      return rows.map((row) => ({
        ...row,
        userId: row.userId || null,
        name: row.name || "مستخدم محذوف",
        email: row.email || "لا يوجد بريد",
      }));
    }),

    getActivityLogs: protectedProcedure.query(async ({ ctx }) => {
      const { ENV } = await import("./_core/env");
      if (ctx.user.openId !== ENV.ownerOpenId) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const database = await getDb();
      if (!database) return [];
      return database.select().from(adminActivityLogs).orderBy(desc(adminActivityLogs.createdAt)).limit(50);
    }),

    deleteActivityLog: protectedProcedure
      .input(z.object({ logId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const { ENV } = await import("./_core/env");
        if (ctx.user.openId !== ENV.ownerOpenId) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }

        await logAdminAction(ctx, {
          action: "blocked_delete_audit_log",
          targetOpenId: `audit_log:${input.logId}`,
          details: AUDIT_LOG_DELETE_DISABLED_MESSAGE,
        });
        assertAuditLogDeletionDisabled();
      }),

    clearActivityLogs: protectedProcedure
      .mutation(async ({ ctx }) => {
        const { ENV } = await import("./_core/env");
        if (ctx.user.openId !== ENV.ownerOpenId) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }

        await logAdminAction(ctx, {
          action: "blocked_clear_audit_logs",
          details: AUDIT_LOG_DELETE_DISABLED_MESSAGE,
        });
        assertAuditLogDeletionDisabled();
      }),

    changeUserRole: protectedProcedure
      .input(z.object({ userId: z.number(), role: z.enum(["admin", "teacher", "student", "user"]) }))
      .mutation(async ({ ctx, input }) => {
        requireOwner(ctx);
        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const targetUser = await database.select().from(users).where(eq(users.id, input.userId)).limit(1);
        if (targetUser.length === 0) {
          throw new TRPCError({ code: "NOT_FOUND", message: "المستخدم غير موجود" });
        }
        if (targetUser[0].openId === ctx.user.openId || targetUser[0].id === ctx.user.id) {
          await logAdminAction(ctx, {
            action: "blocked_change_self_role",
            targetOpenId: targetUser[0].openId,
            details: `محاولة تغيير دور الحساب الحالي إلى ${input.role}`,
          });
        }
        assertCanChangeRole(ctx, targetUser[0], input.role);

        await database.update(users).set({ role: input.role }).where(eq(users.id, input.userId));
        await logAdminAction(ctx, {
          action: "change_user_role",
          targetOpenId: targetUser[0].openId,
          details: `تم تغيير الدور إلى ${input.role}`,
        });
        return { success: true };
      }),

    deleteUser: protectedProcedure
      .input(z.object({ userId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        requireOwner(ctx);
        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const userToDelete = await database.select().from(users).where(eq(users.id, input.userId)).limit(1);
        await logAdminAction(ctx, {
          action: "blocked_delete_user",
          targetOpenId: userToDelete[0]?.openId || `user:${input.userId}`,
          details: "حذف المستخدمين غير مفعل حاليًا لحماية البيانات.",
        });
        assertDeleteUsersDisabled();
      }),

    banUser: protectedProcedure
      .input(z.object({ userId: z.number(), reason: z.string().min(1).optional() }))
      .mutation(async ({ ctx, input }) => {
        requireOwner(ctx);
        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const targetUser = await database.select().from(users).where(eq(users.id, input.userId)).limit(1);
        if (targetUser.length === 0) {
          throw new TRPCError({ code: "NOT_FOUND", message: "المستخدم غير موجود" });
        }
        if (targetUser[0].openId === ENV.ownerOpenId || targetUser[0].openId === ctx.user.openId || targetUser[0].id === ctx.user.id) {
          await logAdminAction(ctx, {
            action: "blocked_ban_owner",
            targetOpenId: targetUser[0].openId,
            details: "محاولة حظر مالك المنصة أو الحساب الحالي.",
          });
        }
        assertCanBanUser(ctx, targetUser[0]);

        const reason = input.reason?.trim() || "تم حظر الحساب من قبل الإدارة";
        await db.banUser(targetUser[0].openId, reason, ctx.user.openId);
        await logAdminAction(ctx, {
          action: "ban_user",
          targetOpenId: targetUser[0].openId,
          details: reason,
        });
        return { success: true };
      }),

    unbanUser: protectedProcedure
      .input(z.object({ userId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        requireOwner(ctx);
        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const targetUser = await database.select().from(users).where(eq(users.id, input.userId)).limit(1);
        if (targetUser.length === 0) {
          throw new TRPCError({ code: "NOT_FOUND", message: "المستخدم غير موجود" });
        }
        if (targetUser[0].openId === ENV.ownerOpenId || targetUser[0].openId === ctx.user.openId || targetUser[0].id === ctx.user.id) {
          await logAdminAction(ctx, {
            action: "blocked_ban_owner",
            targetOpenId: targetUser[0].openId,
            details: "محاولة فك/تعديل حظر مالك المنصة أو الحساب الحالي.",
          });
        }
        assertCanBanUser(ctx, targetUser[0]);

        await db.unbanUser(targetUser[0].openId);
        await logAdminAction(ctx, {
          action: "unban_user",
          targetOpenId: targetUser[0].openId,
          details: "تم فك الحظر من لوحة الإدارة",
        });
        return { success: true };
      }),

    deleteBannedRecord: protectedProcedure
      .input(z.object({ openId: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        const { ENV } = await import("./_core/env");
        if (ctx.user.openId !== ENV.ownerOpenId) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }

        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const existingUser = await database
          .select({ id: users.id })
          .from(users)
          .where(eq(users.openId, input.openId))
          .limit(1);

        if (existingUser.length > 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "لا يمكن حذف سجل محظور لمستخدم موجود. استخدم زر فك الحظر بدلاً من ذلك.",
          });
        }

        await db.unbanUser(input.openId);
        await logAdminAction(ctx, {
          action: "delete_banned_record",
          targetOpenId: input.openId,
          details: "تم حذف سجل المحظور (لحساب غير موجود)",
        });
        return { success: true };
      }),
  }),

  // إدارة الاختبارات
  quiz: router({
    // الحصول على اختبار حسب معرف الدرس
    getByLessonId: protectedProcedure
      .input(z.object({ lessonId: z.number() }))
      .query(async ({ input, ctx }) => {
        const database = await getDb();
        if (!database) return null;

        if (ctx.user.role === "student" || ctx.user.role === "user") {
          const lessonRows = await database
            .select({
              id: lessons.id,
              classId: lessons.classId,
              isVisible: lessons.isVisible,
              contentScope: lessons.contentScope,
              ownerTeacherId: lessons.ownerTeacherId,
              teacherId: lessons.teacherId,
              grade: lessons.grade,
              gradeId: lessons.gradeId,
              termId: lessons.termId,
              termLabelRaw: lessons.termLabelRaw,
            })
            .from(lessons)
            .where(eq(lessons.id, input.lessonId))
            .limit(1);

          const lesson = lessonRows[0];
          if (!lesson) {
            throw new TRPCError({ code: "NOT_FOUND", message: "الدرس غير موجود" });
          }

          const hasAccess = await canUserAccessLessonForPlayback({
            database,
            user: { id: Number(ctx.user.id), role: String(ctx.user.role || "") },
            lesson: {
              id: Number(lesson.id),
              classId: lesson.classId == null ? null : Number(lesson.classId),
              isVisible: lesson.isVisible,
              contentScope: lesson.contentScope == null ? null : String(lesson.contentScope),
              ownerTeacherId: lesson.ownerTeacherId == null ? null : Number(lesson.ownerTeacherId),
              teacherId: lesson.teacherId == null ? null : Number(lesson.teacherId),
              grade: lesson.grade == null ? null : String(lesson.grade),
              gradeId: lesson.gradeId == null ? null : Number(lesson.gradeId),
              termId: lesson.termId == null ? null : Number(lesson.termId),
              termLabelRaw: lesson.termLabelRaw == null ? null : String(lesson.termLabelRaw),
            },
          });

          if (!hasAccess) {
            throw new TRPCError({ code: "FORBIDDEN", message: "لا تملك صلاحية الوصول لاختبار هذا الدرس" });
          }
        }

        const allForLesson = await database
          .select({
            id: quizzes.id,
            lessonId: quizzes.lessonId,
            title: quizzes.title,
            description: quizzes.description,
            questions: quizzes.questions,
            quizTermId: quizzes.termId,
            quizTermLabelRaw: quizzes.termLabelRaw,
            passingScore: quizzes.passingScore,
            createdAt: quizzes.createdAt,
            updatedAt: quizzes.updatedAt,
          })
          .from(quizzes)
          .where(eq(quizzes.lessonId, input.lessonId))
          .orderBy(desc(quizzes.updatedAt), desc(quizzes.createdAt));

        const visible = allForLesson.filter((item) => !isQuizHidden(item.description));
        const candidates = (ctx.user.role === "student" || ctx.user.role === "user")
          ? visible
          : (visible.length > 0 ? visible : allForLesson);
        if (candidates.length === 0) return null;

        const enriched = candidates.map((quizItem) => {
          const normalizedQuestions = parseAndNormalizeQuizQuestions(quizItem.questions);
          return {
            quizItem,
            normalizedQuestions,
            score: scoreQuizQuestions(normalizedQuestions),
          };
        });

        enriched.sort((a, b) => b.score - a.score || Number(b.quizItem.id) - Number(a.quizItem.id));
        const best = enriched[0];

        if (best.normalizedQuestions.length === 0) {
          return null;
        }

        return {
          ...best.quizItem,
          questions: JSON.stringify(best.normalizedQuestions),
        };
      }),

    listForManagement: protectedProcedure
      .query(async ({ ctx }) => {
        if (ctx.user.role !== "admin" && ctx.user.role !== "teacher") {
          throw new TRPCError({ code: "FORBIDDEN" });
        }

        const database = await getDb();
        if (!database) return [];

        const rows = await database
          .select({
            id: quizzes.id,
            lessonId: quizzes.lessonId,
            title: quizzes.title,
            description: quizzes.description,
            questions: quizzes.questions,
            quizTermId: quizzes.termId,
            quizTermLabelRaw: quizzes.termLabelRaw,
            passingScore: quizzes.passingScore,
            createdAt: quizzes.createdAt,
            updatedAt: quizzes.updatedAt,
            lessonTitle: lessons.title,
            lessonGrade: lessons.grade,
            lessonTermId: lessons.termId,
            lessonTermLabelRaw: lessons.termLabelRaw,
            lessonDescription: lessons.description,
            lessonContent: lessons.content,
            lessonPdfUrl: lessons.pdfUrl,
          })
          .from(quizzes)
          .innerJoin(lessons, eq(quizzes.lessonId, lessons.id))
          .orderBy(desc(quizzes.updatedAt), desc(quizzes.createdAt));

        const quizIds = rows.map((row) => Number(row.id));
        const sourceRecords = quizIds.length
          ? await database
              .select({ entityId: contentSourceRecords.entityId })
              .from(contentSourceRecords)
              .where(and(eq(contentSourceRecords.entityType, "quiz"), inArray(contentSourceRecords.entityId, quizIds)))
          : [];
        const importedSet = new Set(sourceRecords.map((record) => Number(record.entityId)));

        return rows.map((row) => {
          const normalizedQuestions = parseAndNormalizeQuizQuestions(row.questions);
          const hidden = isQuizHidden(row.description);
          const sourceType = inferQuizSourceType(row.description, importedSet.has(Number(row.id)));
          const canonicalTerm = String(row.quizTermLabelRaw || row.lessonTermLabelRaw || "").trim();
          const term = canonicalTerm || inferQuizSemester([
            row.title,
            row.description,
            row.lessonTitle,
            row.lessonDescription,
            row.lessonContent,
            row.lessonPdfUrl,
          ]);
          return {
            id: row.id,
            lessonId: row.lessonId,
            title: row.title,
            description: row.description,
            lessonTitle: row.lessonTitle,
            grade: row.lessonGrade || "",
            termId: row.quizTermId ?? row.lessonTermId,
            termLabelRaw: row.quizTermLabelRaw || row.lessonTermLabelRaw,
            term,
            sourceType,
            questionCount: normalizedQuestions.length,
            hidden,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
            questions: normalizedQuestions,
          };
        });
      }),

    updateQuiz: protectedProcedure
      .input(
        z.object({
          id: z.number(),
          title: z.string().min(1).max(255),
          description: z.string().optional(),
          passingScore: z.number().min(1).max(100),
          questions: z.array(
            z.object({
              id: z.string(),
              type: z.enum(["multiple", "truefalse", "short_text"]),
              question: z.string().min(1),
              options: z.array(z.string()),
              correctAnswer: z.union([z.string(), z.number(), z.boolean()]),
              explanation: z.string().optional(),
              acceptableAnswers: z.array(z.string()).optional(),
            })
          ).min(1),
        })
      )
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin" && ctx.user.role !== "teacher") {
          throw new TRPCError({ code: "FORBIDDEN" });
        }

        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        await db.updateQuizNew(input.id, {
          title: input.title,
          description: markQuizSource(input.description || "", "manual"),
          passingScore: input.passingScore,
          questions: JSON.stringify(input.questions),
        });

        return { success: true };
      }),

    deleteQuiz: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin" && ctx.user.role !== "teacher") {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        await database.delete(quizResults).where(eq(quizResults.quizId, input.id));
        await database.delete(quizzes).where(eq(quizzes.id, input.id));
        return { success: true };
      }),

    deleteQuizQuestions: protectedProcedure
      .input(z.object({ id: z.number(), questionIds: z.array(z.string()).min(1) }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin" && ctx.user.role !== "teacher") {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const row = await database
          .select({
            id: quizzes.id,
            questions: quizzes.questions,
          })
          .from(quizzes)
          .where(eq(quizzes.id, input.id))
          .limit(1);
        if (!row[0]) throw new TRPCError({ code: "NOT_FOUND" });

        const normalized = parseAndNormalizeQuizQuestions(row[0].questions);
        const remaining = normalized.filter((question) => !input.questionIds.includes(question.id));
        if (remaining.length === 0) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "لا يمكن حذف جميع الأسئلة من الاختبار" });
        }

        await db.updateQuizNew(input.id, { questions: JSON.stringify(remaining) });
        return { success: true, remaining: remaining.length };
      }),

    setVisibility: protectedProcedure
      .input(z.object({ id: z.number(), hidden: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin" && ctx.user.role !== "teacher") {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const row = await database.select({ description: quizzes.description }).from(quizzes).where(eq(quizzes.id, input.id)).limit(1);
        if (!row[0]) throw new TRPCError({ code: "NOT_FOUND" });

        await db.updateQuizNew(input.id, { description: setQuizHiddenMarker(row[0].description, input.hidden) });
        return { success: true };
      }),

    bulkAction: protectedProcedure
      .input(
        z.object({
          ids: z.array(z.number()).min(1),
          action: z.enum(["delete", "publish", "hide"]),
        })
      )
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin" && ctx.user.role !== "teacher") {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        if (input.action === "delete") {
          await database.delete(quizResults).where(inArray(quizResults.quizId, input.ids));
          await database.delete(quizzes).where(inArray(quizzes.id, input.ids));
          return { success: true, affected: input.ids.length };
        }

        const targetHidden = input.action === "hide";
        const rows = await database
          .select({ id: quizzes.id, description: quizzes.description })
          .from(quizzes)
          .where(inArray(quizzes.id, input.ids));

        for (const row of rows) {
          await db.updateQuizNew(Number(row.id), { description: setQuizHiddenMarker(row.description, targetHidden) });
        }

        return { success: true, affected: rows.length };
      }),

    regenerateQuestions: protectedProcedure
      .input(z.object({ quizId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin" && ctx.user.role !== "teacher") {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const row = await database
          .select({
            id: quizzes.id,
            lessonId: quizzes.lessonId,
            description: quizzes.description,
          })
          .from(quizzes)
          .where(eq(quizzes.id, input.quizId))
          .limit(1);
        if (!row[0]) throw new TRPCError({ code: "NOT_FOUND", message: "الاختبار غير موجود" });

        const generated = await generateQuizQuestionsFromLesson({
          database,
          lessonId: Number(row[0].lessonId),
        });
        if (!generated.ok) {
          return {
            success: false,
            questionsCount: 0,
            sourceSummary: generated.sourceSummary,
            message: `${generated.reason || "المحتوى غير كافٍ لتوليد اختبار موثوق"}${generated.sourceSummary ? ` | المصادر: ${generated.sourceSummary}` : ""}`,
          };
        }

        await db.updateQuizNew(input.quizId, {
          questions: JSON.stringify(generated.questions),
          description: markQuizSource(String(row[0].description || ""), "generated"),
        });

        return {
          success: true,
          questionsCount: generated.questions.length,
          sourceSummary: generated.sourceSummary,
          message: "تمت إعادة التوليد بنجاح",
        };
      }),

    // إرسال إجابات الاختبار
    submit: protectedProcedure
      .input(z.object({
        quizId: z.number(),
        answers: z.array(z.object({
          questionId: z.union([z.number(), z.string()]),
          answer: z.union([z.number(), z.boolean(), z.string()]),
          isCorrect: z.boolean(),
        })),
        score: z.number(),
        totalQuestions: z.number(),
        correctAnswers: z.number(),
      }))
      .mutation(async ({ ctx, input }) => {
        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        // الحصول على معلومات الاختبار
        const quiz = await database
          .select({
            id: quizzes.id,
            passingScore: quizzes.passingScore,
          })
          .from(quizzes)
          .where(eq(quizzes.id, input.quizId))
          .limit(1);

        if (!quiz[0]) {
          throw new TRPCError({ code: "NOT_FOUND", message: "الاختبار غير موجود" });
        }

        const passed = input.score >= (quiz[0].passingScore || 60);

        // حفظ النتيجة
        await database.insert(quizResults).values({
          quizId: input.quizId,
          studentId: ctx.user.id,
          score: input.score,
          totalQuestions: input.totalQuestions,
          correctAnswers: input.correctAnswers,
          answers: JSON.stringify(input.answers),
          passed,
        });

        return { success: true, passed };
      }),

    // الحصول على نتائج الطالب
    getMyResults: protectedProcedure.query(async ({ ctx }) => {
      const database = await getDb();
      if (!database) return [];

      return database.select({
        id: quizResults.id,
        score: quizResults.score,
        totalQuestions: quizResults.totalQuestions,
        correctAnswers: quizResults.correctAnswers,
        passed: quizResults.passed,
        completedAt: quizResults.completedAt,
        quizTitle: quizzes.title,
        lessonId: quizzes.lessonId,
      })
        .from(quizResults)
        .innerJoin(quizzes, eq(quizResults.quizId, quizzes.id))
        .where(eq(quizResults.studentId, ctx.user.id))
        .orderBy(desc(quizResults.completedAt));
    }),

    // الحصول على نتائج جميع الطلاب (للمعلم)
    getAllResults: protectedProcedure.query(async ({ ctx }) => {
      const database = await getDb();
      if (!database) return [];

      return database.select({
        id: quizResults.id,
        score: quizResults.score,
        totalQuestions: quizResults.totalQuestions,
        correctAnswers: quizResults.correctAnswers,
        passed: quizResults.passed,
        completedAt: quizResults.completedAt,
        studentName: users.name,
        studentId: quizResults.studentId,
        quizTitle: quizzes.title,
        lessonId: quizzes.lessonId,
      })
        .from(quizResults)
        .innerJoin(quizzes, eq(quizResults.quizId, quizzes.id))
        .innerJoin(users, eq(quizResults.studentId, users.id))
        .orderBy(desc(quizResults.completedAt));
    }),
  }),

  // إجراءات الإشعارات
  notifications: router({
    // الحصول على إشعارات الطالب
    getMyNotifications: protectedProcedure.query(async ({ ctx }) => {
      const database = await getDb();
      if (!database) return [];

      return database.select()
        .from(notifications)
        .where(eq(notifications.studentId, ctx.user.id))
        .orderBy(desc(notifications.createdAt))
        .limit(50);
    }),

    // عدد الإشعارات غير المقروءة
    getUnreadCount: protectedProcedure.query(async ({ ctx }) => {
      const database = await getDb();
      if (!database) return 0;

      const result = await database.select({ count: sql<number>`count(*)` })
        .from(notifications)
        .where(and(
          eq(notifications.studentId, ctx.user.id),
          eq(notifications.read, false)
        ));

      return result[0]?.count || 0;
    }),

    // تعليم إشعار كمقروء
    markAsRead: protectedProcedure
      .input(z.object({ notificationId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        await database.update(notifications)
          .set({ read: true })
          .where(and(
            eq(notifications.id, input.notificationId),
            eq(notifications.studentId, ctx.user.id)
          ));

        return { success: true };
      }),

    // تعليم جميع الإشعارات كمقروءة
    markAllAsRead: protectedProcedure.mutation(async ({ ctx }) => {
      const database = await getDb();
      if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      await database.update(notifications)
        .set({ read: true })
        .where(eq(notifications.studentId, ctx.user.id));

      return { success: true };
    }),

    // إرسال إشعار (للمعلم)
    send: protectedProcedure
      .input(z.object({
        studentId: z.number(),
        title: z.string(),
        message: z.string(),
        type: z.enum(["lesson", "grade", "quiz", "achievement", "general"]),
      }))
      .mutation(async ({ ctx, input }) => {
        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        await database.insert(notifications).values({
          studentId: input.studentId,
          title: input.title,
          message: input.message,
          type: input.type,
        });

        return { success: true };
      }),
  }),

  // إجراءات الشهادات
  certificates: router({
    getMyCertificates: protectedProcedure.query(async ({ ctx }) => {
      const database = await getDb();
      if (!database) return [];

      const rows = await database
        .select({
          id: certificates.id,
          certificateNumber: certificates.certificateNumber,
          studentId: certificates.studentId,
          studentName: certificates.studentName,
          pathId: certificates.pathId,
          title: certificates.title,
          description: certificates.description,
          issueDate: certificates.issueDate,
          issueType: certificates.issueType,
          status: certificates.status,
          pathName: learningPaths.title,
        })
        .from(certificates)
        .leftJoin(learningPaths, eq(learningPaths.id, certificates.pathId))
        .where(eq(certificates.studentId, ctx.user.id))
        .orderBy(desc(certificates.issueDate));

      return rows;
    }),

    getTeacherSettings: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role !== "teacher" && ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const database = await getDb();
      if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const settings = await getTeacherCertificateSettings(database, ctx.user.id);
      return {
        profile: settings.profile,
        template: settings.template,
      };
    }),

    updateTemplate: protectedProcedure
      .input(z.object({
        title: z.string().min(3).max(255),
        mainText: z.string().min(10).max(5000),
        congratsText: z.string().max(2000).optional(),
        footerText: z.string().max(2000).optional(),
        issuerName: z.string().max(255).optional(),
        backgroundUrl: z.string().max(5000).optional(),
        ministryLogoUrl: z.string().max(5000).optional(),
        schoolLogoUrl: z.string().max(5000).optional(),
        showTeacherSignature: z.boolean().default(true),
        showPrincipalSignature: z.boolean().default(true),
        showMinistryLogo: z.boolean().default(true),
        showSchoolLogo: z.boolean().default(true),
        showLogo: z.boolean().default(false),
        ministryLogoAlign: z.enum(["right", "center", "left"]).default("right"),
        schoolLogoAlign: z.enum(["right", "center", "left"]).default("left"),
        titleAlign: z.enum(["top", "center"]).default("top"),
        nameAlign: z.enum(["center", "right"]).default("center"),
        titleFontSize: z.number().int().min(30).max(64).default(46),
        studentNameFontSize: z.number().int().min(28).max(72).default(47),
        pathNameFontSize: z.number().int().min(22).max(54).default(33),
        mainTextFontSize: z.number().int().min(16).max(42).default(27),
        congratsTextFontSize: z.number().int().min(16).max(42).default(27),
        footerTextFontSize: z.number().int().min(14).max(34).default(20),
      }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "teacher" && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN" });
        }

        await assertTeacherFeatureAccess({
          user: ctx.user,
          featureCode: SUBSCRIPTION_FEATURES.certificates,
        });

        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const existing = await database
          .select({ id: certificateTemplates.id })
          .from(certificateTemplates)
          .where(eq(certificateTemplates.teacherId, ctx.user.id))
          .limit(1);

        if (existing[0]) {
          await database
            .update(certificateTemplates)
            .set({
              ...input,
              congratsText: input.congratsText || null,
              footerText: input.footerText || null,
              issuerName: input.issuerName || null,
              backgroundUrl: input.backgroundUrl || null,
              ministryLogoUrl: input.ministryLogoUrl || null,
              schoolLogoUrl: input.schoolLogoUrl || null,
            })
            .where(eq(certificateTemplates.teacherId, ctx.user.id));
        } else {
          await database.insert(certificateTemplates).values({
            teacherId: ctx.user.id,
            ...input,
            congratsText: input.congratsText || null,
            footerText: input.footerText || null,
            issuerName: input.issuerName || null,
            backgroundUrl: input.backgroundUrl || null,
            ministryLogoUrl: input.ministryLogoUrl || null,
            schoolLogoUrl: input.schoolLogoUrl || null,
          });
        }

        return { success: true };
      }),

    getIssuanceOptions: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role !== "teacher" && ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const database = await getDb();
      if (!database) return { students: [], paths: [] };

      const myClasses = ctx.user.role === "admin"
        ? await database.select({ id: classes.id, grade: classes.grade }).from(classes)
        : await database
            .select({ id: classes.id, grade: classes.grade })
            .from(classes)
            .where(eq(classes.teacherId, ctx.user.id));

      const classGradeById = new Map(myClasses.map((item: any) => [Number(item.id), String(item.grade || "").trim()]));

      const classIds = myClasses.map((item: any) => item.id);
      const students = classIds.length
        ? await database
            .select({
              studentId: classStudents.studentId,
              studentName: classStudents.studentName,
              classId: classStudents.classId,
              classGrade: classes.grade,
            })
            .from(classStudents)
            .innerJoin(classes, eq(classes.id, classStudents.classId))
            .where(inArray(classStudents.classId, classIds))
        : [];

      const uniqueStudents = Array.from(
        new Map(students.map((item: any) => [item.studentId, item])).values(),
      ).map((item: any) => ({
        ...item,
        grade: String(item.classGrade || "").trim() || String(classGradeById.get(Number(item.classId)) || "").trim() || null,
      }));

      const paths = ctx.user.role === "admin"
        ? await database
            .select({
              id: learningPaths.id,
              title: learningPaths.title,
              grade: learningPaths.grade,
              classId: learningPaths.classId,
            })
            .from(learningPaths)
            .orderBy(desc(learningPaths.updatedAt))
        : await database
            .select({
              id: learningPaths.id,
              title: learningPaths.title,
              grade: learningPaths.grade,
              classId: learningPaths.classId,
            })
            .from(learningPaths)
            .where(eq(learningPaths.teacherId, ctx.user.id))
            .orderBy(desc(learningPaths.updatedAt));

      const normalizedPaths = paths.map((path: any) => ({
        ...path,
        grade:
          String(path.grade || "").trim() ||
          String(classGradeById.get(Number(path.classId)) || "").trim() ||
          null,
      }));

      const grades = Array.from(
        new Set(
          [
            ...uniqueStudents.map((item: any) => String(item.grade || "").trim()),
            ...normalizedPaths.map((item: any) => String(item.grade || "").trim()),
          ].filter(Boolean),
        ),
      );

      return {
        students: uniqueStudents,
        paths: normalizedPaths,
        grades,
      };
    }),

    getGrantedManual: protectedProcedure
      .input(z.object({ grade: z.string().optional() }).optional())
      .query(async ({ ctx, input }) => {
        if (ctx.user.role !== "teacher" && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN" });
        }

        const database = await getDb();
        if (!database) return [];

        const grade = String(input?.grade || "").trim();
        const conditions: SQL<unknown>[] = [eq(certificates.issueType, "manual")];

        if (ctx.user.role !== "admin") {
          conditions.push(eq(certificates.issuedByUserId, ctx.user.id));
        }

        if (grade) {
          conditions.push(
            or(eq(learningPaths.grade, grade), eq(classes.grade, grade)) as SQL<unknown>,
          );
        }

        const whereClause = conditions.length === 1 ? conditions[0] : and(...conditions);

        const rows = await database
          .select({
            id: certificates.id,
            certificateNumber: certificates.certificateNumber,
            studentId: certificates.studentId,
            studentName: certificates.studentName,
            pathId: certificates.pathId,
            pathName: learningPaths.title,
            gradeFromPath: learningPaths.grade,
            gradeFromClass: classes.grade,
            issueDate: certificates.issueDate,
            description: certificates.description,
            title: certificates.title,
            issuedByUserId: certificates.issuedByUserId,
          })
          .from(certificates)
          .leftJoin(learningPaths, eq(learningPaths.id, certificates.pathId))
          .leftJoin(classes, eq(classes.id, learningPaths.classId))
          .where(whereClause)
          .orderBy(desc(certificates.issueDate));

        return rows.map((row: any) => ({
          ...row,
          grade: String(row.gradeFromPath || "").trim() || String(row.gradeFromClass || "").trim() || null,
        }));
      }),

    updateGrantedManual: protectedProcedure
      .input(
        z.object({
          certificateId: z.number(),
          title: z.string().max(255).optional(),
          description: z.string().max(1000).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "teacher" && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN" });
        }

        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const [existing] = await database
          .select({
            id: certificates.id,
            issueType: certificates.issueType,
            issuedByUserId: certificates.issuedByUserId,
          })
          .from(certificates)
          .where(eq(certificates.id, input.certificateId))
          .limit(1);

        if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "الشهادة غير موجودة" });
        if (existing.issueType !== "manual") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "يمكن تعديل الشهادات اليدوية فقط" });
        }
        if (ctx.user.role !== "admin" && Number(existing.issuedByUserId) !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN", message: "لا يمكنك تعديل شهادة لم تقم بمنحها" });
        }

        await database
          .update(certificates)
          .set({
            title: input.title ? input.title.trim() : undefined,
            description: input.description ? input.description.trim() : null,
          })
          .where(eq(certificates.id, input.certificateId));

        return { success: true };
      }),

    deleteGrantedManual: protectedProcedure
      .input(z.object({ certificateId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "teacher" && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN" });
        }

        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const [existing] = await database
          .select({
            id: certificates.id,
            issueType: certificates.issueType,
            issuedByUserId: certificates.issuedByUserId,
          })
          .from(certificates)
          .where(eq(certificates.id, input.certificateId))
          .limit(1);

        if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "الشهادة غير موجودة" });
        if (existing.issueType !== "manual") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "يمكن حذف الشهادات اليدوية فقط" });
        }
        if (ctx.user.role !== "admin" && Number(existing.issuedByUserId) !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN", message: "لا يمكنك حذف شهادة لم تقم بمنحها" });
        }

        await database.delete(certificates).where(eq(certificates.id, input.certificateId));
        return { success: true };
      }),

    grantManual: protectedProcedure
      .input(z.object({
        studentId: z.number(),
        pathId: z.number(),
        allowDuplicate: z.boolean().default(false),
        reason: z.string().max(1000).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "teacher" && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN" });
        }

        await assertTeacherFeatureAccess({
          user: ctx.user,
          featureCode: SUBSCRIPTION_FEATURES.createCertificate,
        });

        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const [student] = await database
          .select({ id: users.id, name: users.name })
          .from(users)
          .where(eq(users.id, input.studentId))
          .limit(1);

        const [path] = await database
          .select({ id: learningPaths.id, title: learningPaths.title, teacherId: learningPaths.teacherId })
          .from(learningPaths)
          .where(eq(learningPaths.id, input.pathId))
          .limit(1);

        if (!student) throw new TRPCError({ code: "NOT_FOUND", message: "الطالب غير موجود" });
        if (!path) throw new TRPCError({ code: "NOT_FOUND", message: "المسار غير موجود" });

        if (ctx.user.role !== "admin" && path.teacherId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN", message: "لا يمكنك منح شهادة لمسار لا تملكه" });
        }

        const existing = await database
          .select({ id: certificates.id })
          .from(certificates)
          .where(and(eq(certificates.studentId, input.studentId), eq(certificates.pathId, input.pathId), eq(certificates.issueType, "manual")))
          .limit(1);

        if (existing[0] && !input.allowDuplicate) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "تم إصدار شهادة يدوية لهذا الطالب في هذا المسار مسبقًا",
          });
        }

        const certificateNumber = `CERT-M-${Date.now()}-${input.studentId}`;
        await database.insert(certificates).values({
          studentId: input.studentId,
          pathId: input.pathId,
          certificateNumber,
          studentName: student.name || "طالب",
          title: `شهادة المسار: ${path.title}`,
          description: input.reason || `شهادة ممنوحة يدويًا لمسار ${path.title}`,
          issueType: "manual",
          status: "granted",
          issuedByUserId: ctx.user.id,
        });

        await database.insert(notifications).values({
          studentId: input.studentId,
          title: "تم منحك شهادة جديدة",
          message: `تم منحك شهادة لمسار "${path.title}" من قبل المعلم.`,
          type: "achievement",
        });

        return { success: true, certificateNumber };
      }),

    issueManual: protectedProcedure
      .input(z.object({
        studentId: z.number(),
        pathId: z.number().optional(),
        title: z.string().optional(),
        description: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        await assertTeacherFeatureAccess({
          user: ctx.user,
          featureCode: SUBSCRIPTION_FEATURES.createCertificate,
        });

        if (!input.pathId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "يجب اختيار المسار" });
        }
        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const [student] = await database
          .select({ id: users.id, name: users.name })
          .from(users)
          .where(eq(users.id, input.studentId))
          .limit(1);
        const [path] = await database
          .select({ id: learningPaths.id, title: learningPaths.title, teacherId: learningPaths.teacherId })
          .from(learningPaths)
          .where(eq(learningPaths.id, input.pathId))
          .limit(1);
        if (!student || !path) throw new TRPCError({ code: "NOT_FOUND", message: "الطالب أو المسار غير موجود" });
        if (ctx.user.role !== "admin" && path.teacherId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        const existing = await database
          .select({ id: certificates.id })
          .from(certificates)
          .where(and(eq(certificates.studentId, input.studentId), eq(certificates.pathId, input.pathId), eq(certificates.issueType, "manual")))
          .limit(1);
        if (existing[0]) {
          throw new TRPCError({ code: "CONFLICT", message: "تم إصدار شهادة يدوية لهذا الطالب في هذا المسار مسبقًا" });
        }
        const certificateNumber = `CERT-M-${Date.now()}-${input.studentId}`;
        await database.insert(certificates).values({
          studentId: input.studentId,
          pathId: input.pathId,
          certificateNumber,
          studentName: student.name || "طالب",
          title: input.title || `شهادة المسار: ${path.title}`,
          description: input.description || `شهادة ممنوحة يدويًا لمسار ${path.title}`,
          issueType: "manual",
          status: "granted",
          issuedByUserId: ctx.user.id,
        });
        return { success: true, certificateNumber };
      }),

    issue: protectedProcedure
      .input(z.object({
        studentId: z.number(),
        pathId: z.number().optional(),
        title: z.string().optional(),
        description: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        await assertTeacherFeatureAccess({
          user: ctx.user,
          featureCode: SUBSCRIPTION_FEATURES.createCertificate,
        });

        if (!input.pathId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "يجب اختيار المسار" });
        }
        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const [student] = await database
          .select({ id: users.id, name: users.name })
          .from(users)
          .where(eq(users.id, input.studentId))
          .limit(1);
        const [path] = await database
          .select({ id: learningPaths.id, title: learningPaths.title, teacherId: learningPaths.teacherId })
          .from(learningPaths)
          .where(eq(learningPaths.id, input.pathId))
          .limit(1);
        if (!student || !path) throw new TRPCError({ code: "NOT_FOUND", message: "الطالب أو المسار غير موجود" });
        if (ctx.user.role !== "admin" && path.teacherId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        const existing = await database
          .select({ id: certificates.id })
          .from(certificates)
          .where(and(eq(certificates.studentId, input.studentId), eq(certificates.pathId, input.pathId), eq(certificates.issueType, "manual")))
          .limit(1);
        if (existing[0]) {
          throw new TRPCError({ code: "CONFLICT", message: "تم إصدار شهادة يدوية لهذا الطالب في هذا المسار مسبقًا" });
        }
        const certificateNumber = `CERT-M-${Date.now()}-${input.studentId}`;
        await database.insert(certificates).values({
          studentId: input.studentId,
          pathId: input.pathId,
          certificateNumber,
          studentName: student.name || "طالب",
          title: input.title || `شهادة المسار: ${path.title}`,
          description: input.description || `شهادة ممنوحة يدويًا لمسار ${path.title}`,
          issueType: "manual",
          status: "granted",
          issuedByUserId: ctx.user.id,
        });
        return { success: true, certificateNumber };
      }),

    getPreview: protectedProcedure
      .input(z.object({
        studentId: z.number().optional(),
        pathId: z.number().optional(),
      }).optional())
      .query(async ({ ctx, input }) => {
        if (ctx.user.role !== "teacher" && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        let certificateRow: any = null;

        if (input?.studentId && input?.pathId) {
          const [existing] = await database
            .select()
            .from(certificates)
            .where(and(eq(certificates.studentId, input.studentId), eq(certificates.pathId, input.pathId)))
            .orderBy(desc(certificates.issueDate))
            .limit(1);
          certificateRow = existing || null;
        }

        if (!certificateRow) {
          const [previewStudent] = input?.studentId
            ? await database
                .select({ id: users.id, name: users.name })
                .from(users)
                .where(eq(users.id, input.studentId))
                .limit(1)
            : [null];

          const [previewPath] = input?.pathId
            ? await database
                .select({ id: learningPaths.id, title: learningPaths.title })
                .from(learningPaths)
                .where(eq(learningPaths.id, input.pathId))
                .limit(1)
            : [null];

          const [firstPath] = previewPath
            ? [previewPath]
            : ctx.user.role === "admin"
              ? await database
                  .select({ id: learningPaths.id, title: learningPaths.title })
                  .from(learningPaths)
                  .limit(1)
              : await database
                  .select({ id: learningPaths.id, title: learningPaths.title })
                  .from(learningPaths)
                  .where(eq(learningPaths.teacherId, ctx.user.id))
                  .limit(1);

          const previewStudentName = String(previewStudent?.name || "").trim();

          certificateRow = {
            id: -1,
            studentId: previewStudent?.id || input?.studentId || ctx.user.id,
            pathId: input?.pathId || firstPath?.id || null,
            certificateNumber: "PREVIEW-LOCAL",
            studentName: previewStudentName || (input?.studentId ? "" : "اسم الطالب/الطالبة"),
            title: firstPath ? `شهادة المسار: ${firstPath.title}` : "شهادة المسار",
            description: "معاينة مباشرة للقالب",
            issueDate: new Date(),
            issueType: "manual",
            status: "granted",
            issuedByUserId: ctx.user.id,
          };
        }

        const model = await buildStudentCertificateViewModel({ database, certificate: certificateRow });
        const { generateLearningPathCertificateHTML } = await import("./certificateGenerator");
        const html = generateLearningPathCertificateHTML({
          certificateNumber: model.certificate.certificateNumber,
          renderedTitle: model.rendered.title,
          renderedMainText: model.rendered.mainText,
          renderedCongratsText: model.rendered.congratsText,
          renderedFooterText: model.rendered.footerText,
          studentName: model.display.studentName,
          pathName: model.display.pathName,
          schoolName: model.display.schoolName,
          issueDate: model.display.issueDate,
          teacherLabel: model.textContext.teacherLabel,
          teacherName: model.display.teacherName,
          principalLabel: model.textContext.principalLabel,
          principalName: model.display.principalName,
          teacherSignatureUrl: model.display.teacherSignature,
          principalSignatureUrl: model.display.principalSignature,
          showTeacherSignature: model.template.showTeacherSignature,
          showPrincipalSignature: model.template.showPrincipalSignature,
          backgroundUrl: model.template.backgroundUrl,
          ministryLogoUrl: model.template.ministryLogoUrl,
          schoolLogoUrl: model.template.schoolLogoUrl,
          showMinistryLogo: model.template.showMinistryLogo,
          showSchoolLogo: model.template.showSchoolLogo,
          ministryLogoAlign: model.template.ministryLogoAlign,
          schoolLogoAlign: model.template.schoolLogoAlign,
          titleAlign: model.template.titleAlign,
          nameAlign: model.template.nameAlign,
          titleFontSize: model.template.titleFontSize,
          studentNameFontSize: model.template.studentNameFontSize,
          pathNameFontSize: model.template.pathNameFontSize,
          mainTextFontSize: model.template.mainTextFontSize,
          congratsTextFontSize: model.template.congratsTextFontSize,
          footerTextFontSize: model.template.footerTextFontSize,
        });

        return { html, model };
      }),

    generateHTML: protectedProcedure
      .input(z.object({ certificateId: z.number() }))
      .query(async ({ ctx, input }) => {
        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const [cert] = await database
          .select()
          .from(certificates)
          .where(eq(certificates.id, input.certificateId))
          .limit(1);

        if (!cert) {
          throw new TRPCError({ code: "NOT_FOUND", message: "الشهادة غير موجودة" });
        }

        const canView =
          ctx.user.role === "admin" ||
          ctx.user.role === "teacher" ||
          cert.studentId === ctx.user.id;
        if (!canView) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }

        const model = await buildStudentCertificateViewModel({ database, certificate: cert });
        const { generateLearningPathCertificateHTML } = await import("./certificateGenerator");
        const html = generateLearningPathCertificateHTML({
          certificateNumber: model.certificate.certificateNumber,
          renderedTitle: model.rendered.title,
          renderedMainText: model.rendered.mainText,
          renderedCongratsText: model.rendered.congratsText,
          renderedFooterText: model.rendered.footerText,
          studentName: model.display.studentName,
          pathName: model.display.pathName,
          schoolName: model.display.schoolName,
          issueDate: model.display.issueDate,
          teacherLabel: model.textContext.teacherLabel,
          teacherName: model.display.teacherName,
          principalLabel: model.textContext.principalLabel,
          principalName: model.display.principalName,
          teacherSignatureUrl: model.display.teacherSignature,
          principalSignatureUrl: model.display.principalSignature,
          showTeacherSignature: model.template.showTeacherSignature,
          showPrincipalSignature: model.template.showPrincipalSignature,
          backgroundUrl: model.template.backgroundUrl,
          ministryLogoUrl: model.template.ministryLogoUrl,
          schoolLogoUrl: model.template.schoolLogoUrl,
          showMinistryLogo: model.template.showMinistryLogo,
          showSchoolLogo: model.template.showSchoolLogo,
          ministryLogoAlign: model.template.ministryLogoAlign,
          schoolLogoAlign: model.template.schoolLogoAlign,
          titleAlign: model.template.titleAlign,
          nameAlign: model.template.nameAlign,
          titleFontSize: model.template.titleFontSize,
          studentNameFontSize: model.template.studentNameFontSize,
          pathNameFontSize: model.template.pathNameFontSize,
          mainTextFontSize: model.template.mainTextFontSize,
          congratsTextFontSize: model.template.congratsTextFontSize,
          footerTextFontSize: model.template.footerTextFontSize,
        });

        return { html, certificate: cert, model };
      }),

    uploadImage: protectedProcedure
      .input(z.object({
        imageData: z.string().min(1),
        fileName: z.string().min(1).optional(),
        mimeType: z.string().min(1).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "teacher" && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN" });
        }

        const mimeType = input.mimeType || "image/png";
        if (!mimeType.startsWith("image/")) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "نوع الملف غير مدعوم" });
        }

        const cleanedBase64 = input.imageData.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, "");
        const buffer = Buffer.from(cleanedBase64, "base64");
        if (!buffer.length) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "بيانات الصورة غير صالحة" });
        }
        if (buffer.length > 8 * 1024 * 1024) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "حجم الصورة يجب ألا يتجاوز 8MB" });
        }

        const extension = mimeType.split("/")[1] || "png";
        const safeName = (input.fileName || "certificate-asset")
          .replace(/\.[^/.]+$/, "")
          .replace(/[^a-zA-Z0-9-_]/g, "-")
          .slice(0, 60);
        const objectName = `certificates/${ctx.user.id}/${Date.now()}-${safeName}.${extension}`;

        const uploaded = await storagePut(objectName, buffer, mimeType);
        return { success: true, url: uploaded.url, key: uploaded.key };
      }),

    // توليد HTML للتقرير
    generateReportHTML: protectedProcedure
      .input(z.object({
        studentId: z.number(),
        classId: z.number(),
      }))
      .query(async ({ ctx, input }) => {
        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        // الحصول على معلومات الطالب
        const student = await database.select()
          .from(users)
          .where(eq(users.id, input.studentId))
          .limit(1);

        if (!student[0]) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }

        // الحصول على معلومات الفصل
        const classInfo = await database.select()
          .from(classes)
          .where(eq(classes.id, input.classId))
          .limit(1);

        const classStudentRecord = await database.select()
          .from(classStudents)
          .where(and(
            eq(classStudents.classId, input.classId),
            eq(classStudents.studentId, input.studentId)
          ))
          .limit(1);

        // الحصول على نتائج الاختبارات
        const quizResultsData = await database.select({
          id: quizResults.id,
          score: quizResults.score,
          totalQuestions: quizResults.totalQuestions,
          correctAnswers: quizResults.correctAnswers,
          passed: quizResults.passed,
          completedAt: quizResults.completedAt,
          quizTitle: quizzes.title,
        })
          .from(quizResults)
          .innerJoin(quizzes, eq(quizResults.quizId, quizzes.id))
          .where(eq(quizResults.studentId, input.studentId));

        // الحصول على الأعمال الفنية
        const artworksData = await database.select()
          .from(artworks)
          .where(eq(artworks.studentId, input.studentId));

        // حساب متوسط الدرجات
        const avgScore = quizResultsData.length > 0
          ? Math.round(quizResultsData.reduce((sum, q) => sum + q.score, 0) / quizResultsData.length)
          : 0;

        const { generateReportHTML } = await import("./certificateGenerator");
        const html = generateReportHTML({
          studentName: classStudentRecord[0]?.studentName || student[0].name || "طالب",
          className: classInfo[0]?.name || "",
          grade: classInfo[0]?.grade || "",
          quizResults: quizResultsData,
          artworks: artworksData,
          averageScore: avgScore,
          generatedDate: new Date(),
        });

        return { html };
      }),
  }),

  gifted: router({
    getByClass: protectedProcedure
      .input(z.object({ classId: z.number() }))
      .query(async ({ ctx, input }) => {
        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "فشل الاتصال بقاعدة البيانات" });

        // الحصول على طلاب الفصل
        const classStudentsData = await database.select()
          .from(classStudents)
          .where(eq(classStudents.classId, input.classId));

        const studentIds = classStudentsData.map(cs => cs.studentId);

        if (studentIds.length === 0) return [];

        // الحصول على الموهوبين من هذا الفصل
        return await database.select()
          .from(giftedStudents)
          .where(sql`${giftedStudents.studentId} IN (${sql.join(studentIds.map(id => sql`${id}`), sql`, `)})`);      }),

    add: protectedProcedure
      .input(z.object({
        classId: z.number(),
        studentId: z.number(),
        talentArea: z.string(),
        enrichmentProgram: z.string(),
      }))
      .mutation(async ({ ctx, input }) => {
        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "فشل الاتصال بقاعدة البيانات" });

        await database.insert(giftedStudents).values({
          studentId: input.studentId,
          teacherId: ctx.user.id,
          talentField: input.talentArea,
          enrichmentPrograms: input.enrichmentProgram,
        });

        return { success: true };
      }),

    updateProgram: protectedProcedure
      .input(z.object({
        id: z.number(),
        enrichmentProgram: z.string(),
      }))
      .mutation(async ({ ctx, input }) => {
        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "فشل الاتصال بقاعدة البيانات" });

        await database.update(giftedStudents)
          .set({ enrichmentPrograms: input.enrichmentProgram })
          .where(eq(giftedStudents.id, input.id));

        return { success: true };
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const database = await getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "فشل الاتصال بقاعدة البيانات" });

        await database.delete(giftedStudents)
          .where(eq(giftedStudents.id, input.id));

        return { success: true };
      }),
  }),
});

export type AppRouter = typeof appRouter;
