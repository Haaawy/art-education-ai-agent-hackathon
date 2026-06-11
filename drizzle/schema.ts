import { int, mysqlEnum, mysqlTable, text, timestamp, varchar, boolean, index, uniqueIndex } from "drizzle-orm/mysql-core";

const CONTENT_SCOPE_VALUES = ["global", "teacher", "teacher_override"] as const;
const STUDENT_CONTENT_TERM_VISIBILITY_VALUES = ["all", "first", "second"] as const;

/**
 * جدول المستخدمين الأساسي للمصادقة
 */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin", "teacher", "student"]).default("student").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export const teacherCompetitions = mysqlTable(
  "teacherCompetitions",
  {
    id: int("id").autoincrement().primaryKey(),
    teacherId: int("teacherId").notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    description: text("description"),
    coverImageUrl: text("coverImageUrl").notNull(),
    targetGrade: varchar("targetGrade", { length: 80 }),
    targetClassId: int("targetClassId"),
    startDate: timestamp("startDate"),
    endDate: timestamp("endDate"),
    status: mysqlEnum("status", ["draft", "active", "closed", "published", "archived"]).default("draft").notNull(),
    isPublic: boolean("isPublic").default(false).notNull(),
    allowStudentSubmissions: boolean("allowStudentSubmissions").default(false).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => [
    index("idx_teacherCompetitions_teacherId").on(table.teacherId),
    index("idx_teacherCompetitions_targetClassId").on(table.targetClassId),
  ],
);

export const competitionSubmissions = mysqlTable(
  "competitionSubmissions",
  {
    id: int("id").autoincrement().primaryKey(),
    competitionId: int("competitionId").notNull(),
    teacherId: int("teacherId").notNull(),
    studentId: int("studentId"),
    studentName: varchar("studentName", { length: 255 }).notNull(),
    artworkTitle: varchar("artworkTitle", { length: 255 }).notNull(),
    imageUrl: text("imageUrl").notNull(),
    grade: varchar("grade", { length: 80 }),
    className: varchar("className", { length: 255 }),
    description: text("description"),
    teacherNotes: text("teacherNotes"),
    status: mysqlEnum("status", ["pending", "approved", "rejected", "winner", "featured"]).default("pending").notNull(),
    awardRank: mysqlEnum("awardRank", ["first", "second", "third"]),
    isFeatured: boolean("isFeatured").default(false).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => [
    index("idx_competitionSubmissions_competitionId").on(table.competitionId),
    index("idx_competitionSubmissions_teacherId").on(table.teacherId),
    index("idx_competitionSubmissions_studentId").on(table.studentId),
  ],
);

/**
 * جدول الفصول الدراسية
 */
export const classes = mysqlTable("classes", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  grade: varchar("grade", { length: 50 }).notNull(), // الصف الدراسي
  classGender: mysqlEnum("classGender", ["boys", "girls"]),
  studentContentTermVisibility: mysqlEnum("studentContentTermVisibility", STUDENT_CONTENT_TERM_VISIBILITY_VALUES)
    .default("all")
    .notNull(),
  teacherId: int("teacherId").notNull(),
  description: text("description"),
  classCode: varchar("classCode", { length: 20 }).notNull().unique(), // رمز الفصل الفريد للتسجيل
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

/**
 * جدول الطلاب في الفصول
 */
export const classStudents = mysqlTable("classStudents", {
  id: int("id").autoincrement().primaryKey(),
  classId: int("classId").notNull(),
  studentId: int("studentId").notNull(),
  studentName: varchar("studentName", { length: 255 }).notNull(),
  password: varchar("password", { length: 50 }), // الرقم السري للطالب
  joinedAt: timestamp("joinedAt").defaultNow().notNull(),
});

/**
 * جدول الرسومات والأعمال الفنية
 */
export const artworks = mysqlTable("artworks", {
  id: int("id").autoincrement().primaryKey(),
  studentId: int("studentId").notNull(),
  classId: int("classId"),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  imageUrl: text("imageUrl").notNull(), // رابط الصورة في S3
  imageKey: text("imageKey").notNull(), // مفتاح الملف في S3
  lessonId: int("lessonId"), // الدرس المرتبط
  status: mysqlEnum("status", ["draft", "submitted", "reviewed", "published"]).default("submitted").notNull(),
  isPublic: boolean("isPublic").default(false), // هل العمل عام في المعرض
  isFeatured: boolean("isFeatured").default(false), // تمييز العمل كعمل مميز داخل المعرض الحالي
  showInClassGallery: boolean("showInClassGallery").default(true), // الظهور في معرض الفصل
  showInTeacherGallery: boolean("showInTeacherGallery").default(true), // الظهور في معرض المعلم العام
  showInSiteGallery: boolean("showInSiteGallery").default(false), // الظهور في معرض الموقع (مراجعة الإدارة)
  showInStudentPublicGallery: boolean("showInStudentPublicGallery").default(true), // الظهور في رابط معرض الطالب العام
  showInCompetition: boolean("showInCompetition").default(false), // جاهزية ربط العمل بمسابقات مستقبلية
  competitionId: int("competitionId"), // المسابقة المرتبط بها العمل (إن وجدت)
  competitionVotes: int("competitionVotes").default(0).notNull(), // أصوات المسابقة لهذا العمل
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

/**
 * جدول ملاحظات الذكاء الاصطناعي للأعمال الفنية
 * منفصل عن تقييم المعلم الرسمي (reviews)
 */
export const artworkAiFeedback = mysqlTable("artworkAiFeedback", {
  id: int("id").autoincrement().primaryKey(),
  artworkId: int("artworkId").notNull().unique(),
  strength: text("strength").notNull(),
  improvement: text("improvement").notNull(),
  encouragement: text("encouragement").notNull(),
  generatedBy: mysqlEnum("generatedBy", ["vision", "metadata"]).default("metadata").notNull(),
  model: varchar("model", { length: 120 }).default("fallback-metadata-v1").notNull(),
  generatedAt: timestamp("generatedAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const aiArtworkAnalyses = mysqlTable(
  "ai_artwork_analyses",
  {
    id: int("id").autoincrement().primaryKey(),
    artworkId: int("artworkId").notNull(),
    teacherId: int("teacherId").notNull(),
    studentId: int("studentId"),
    resultJson: text("resultJson").notNull(),
    provider: varchar("provider", { length: 80 }).notNull(),
    promptVersion: varchar("promptVersion", { length: 80 }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => [
    index("idx_ai_artwork_analyses_artworkId").on(table.artworkId),
    index("idx_ai_artwork_analyses_teacherId").on(table.teacherId),
    index("idx_ai_artwork_analyses_studentId").on(table.studentId),
  ],
);

/**
 * جدول المسابقات الفنية
 */
export const competitions = mysqlTable("competitions", {
  id: int("id").autoincrement().primaryKey(),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  startDate: timestamp("startDate").notNull(),
  endDate: timestamp("endDate").notNull(),
  isActive: boolean("isActive").default(false).notNull(),
  firstPlaceArtworkId: int("firstPlaceArtworkId"),
  secondPlaceArtworkId: int("secondPlaceArtworkId"),
  thirdPlaceArtworkId: int("thirdPlaceArtworkId"),
  finalizedAt: timestamp("finalizedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

/**
 * جدول أصوات المسابقات الفنية
 */
export const competitionArtworkVotes = mysqlTable("competitionArtworkVotes", {
  id: int("id").autoincrement().primaryKey(),
  competitionId: int("competitionId").notNull(),
  artworkId: int("artworkId").notNull(),
  userId: int("userId").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

/**
 * جدول الدروس التعليمية
 */
export const lessons = mysqlTable(
  "lessons",
  {
    id: int("id").autoincrement().primaryKey(),
    title: varchar("title", { length: 255 }).notNull(),
    description: text("description"),
    content: text("content"), // محتوى الدرس
    contentScope: mysqlEnum("contentScope", CONTENT_SCOPE_VALUES).default("teacher").notNull(),
    ownerTeacherId: int("ownerTeacherId").references(() => users.id, { onDelete: "set null" }),
    createdByUserId: int("createdByUserId").references(() => users.id, { onDelete: "set null" }),
    sourceLessonId: int("sourceLessonId"),
    importJobId: int("importJobId"),
    stageId: int("stageId").references(() => academicStages.id, { onDelete: "set null" }),
    gradeId: int("gradeId").references(() => academicGrades.id, { onDelete: "set null" }),
    termId: int("termId").references(() => academicTerms.id, { onDelete: "set null" }),
    subjectId: int("subjectId").references(() => subjects.id, { onDelete: "set null" }),
    gradeLabelRaw: varchar("gradeLabelRaw", { length: 120 }),
    termLabelRaw: varchar("termLabelRaw", { length: 120 }),
    subjectLabelRaw: varchar("subjectLabelRaw", { length: 120 }),
    grade: varchar("grade", { length: 50 }), // الصف الدراسي المستهدف
    classId: int("classId"), // الفصل المستهدف (اختياري)
    isVisible: boolean("isVisible").default(true), // إظهار/إخفاء الدرس للطلاب
    category: mysqlEnum("category", ["drawing", "decoration", "colors", "texture"]).notNull(),
    videoUrl: text("videoUrl"), // رابط فيديو يوتيوب
    videoStartTime: int("videoStartTime"), // وقت بداية الفيديو (بالثواني)
    videoEndTime: int("videoEndTime"), // وقت نهاية الفيديو (بالثواني)
    videoMuted: boolean("videoMuted").default(false), // كتم صوت الفيديو داخل المنصة
    imageUrl: text("imageUrl"), // صورة توضيحية
    externalQuizUrl: text("externalQuizUrl"), // رابط اختبار خارجي (Google Forms أو غيره)
    pdfUrl: text("pdfUrl"), // رابط كتاب/ملف PDF للدرس
    order: int("order").default(0), // ترتيب الدرس
    teacherId: int("teacherId").notNull(), // المعلم الذي أنشأ الدرس
    parentLessonId: int("parentLessonId"), // الدرس الرئيسي (للدروس الفرعية)
    contentType: mysqlEnum("contentType", ["video", "image", "text", "mixed"]).default("text"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => [
    index("idx_lessons_scope_owner").on(table.contentScope, table.ownerTeacherId),
    index("idx_lessons_canonical").on(table.stageId, table.gradeId, table.termId, table.subjectId),
    index("idx_lessons_source").on(table.sourceLessonId),
  ]
);

/**
 * جدول التحديات الفنية
 */
export const challenges = mysqlTable(
  "challenges",
  {
    id: int("id").autoincrement().primaryKey(),
    title: varchar("title", { length: 255 }).notNull(),
    description: text("description"),
    contentScope: mysqlEnum("contentScope", CONTENT_SCOPE_VALUES).default("teacher").notNull(),
    ownerTeacherId: int("ownerTeacherId").references(() => users.id, { onDelete: "set null" }),
    createdByUserId: int("createdByUserId").references(() => users.id, { onDelete: "set null" }),
    sourceChallengeId: int("sourceChallengeId"),
    importJobId: int("importJobId"),
    stageId: int("stageId").references(() => academicStages.id, { onDelete: "set null" }),
    gradeId: int("gradeId").references(() => academicGrades.id, { onDelete: "set null" }),
    termId: int("termId").references(() => academicTerms.id, { onDelete: "set null" }),
    subjectId: int("subjectId").references(() => subjects.id, { onDelete: "set null" }),
    gradeLabelRaw: varchar("gradeLabelRaw", { length: 120 }),
    termLabelRaw: varchar("termLabelRaw", { length: 120 }),
    subjectLabelRaw: varchar("subjectLabelRaw", { length: 120 }),
    lessonId: int("lessonId"), // إذا كان التحدي مرتبطًا بدرس يرث الفصل منه
    classId: int("classId"), // الفصل المستهدف (اختياري)
    grade: varchar("grade", { length: 50 }), // الصف المستهدف (اختياري)
    isVisible: boolean("isVisible").default(true), // إظهار/إخفاء التحدي للطلاب
    startDate: timestamp("startDate").notNull(),
    endDate: timestamp("endDate").notNull(),
    difficulty: mysqlEnum("difficulty", ["easy", "medium", "hard"]).default("medium"),
    points: int("points").default(10), // نقاط التحدي
    imageUrl: text("imageUrl"), // صورة التحدي
    targetGender: mysqlEnum("targetGender", ["all", "boys", "girls"]).default("all"), // الفئة المستهدفة
    badgeIconUrl: text("badgeIconUrl"), // أيقونة الشارة للفائزين
    teacherId: int("teacherId").notNull(), // المعلم الذي أنشأ التحدي
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => [
    index("idx_challenges_scope_owner").on(table.contentScope, table.ownerTeacherId),
    index("idx_challenges_canonical").on(table.stageId, table.gradeId, table.termId, table.subjectId),
    index("idx_challenges_source").on(table.sourceChallengeId),
  ]
);

/**
 * جدول مشاركات الطلاب في التحديات
 */
export const challengeSubmissions = mysqlTable("challengeSubmissions", {
  id: int("id").autoincrement().primaryKey(),
  challengeId: int("challengeId").notNull(),
  studentId: int("studentId").notNull(),
  artworkId: int("artworkId").notNull(),
  submittedAt: timestamp("submittedAt").defaultNow().notNull(),
  status: mysqlEnum("status", ["pending", "approved", "rejected"]).default("pending"),
});

/**
 * جدول الشارات والإنجازات
 */
export const badges = mysqlTable("badges", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  iconUrl: text("iconUrl"), // أيقونة الشارة
  category: mysqlEnum("category", ["artwork", "participation", "challenge", "special"]).notNull(),
  requirement: int("requirement").default(1), // المتطلب للحصول على الشارة
  isVisible: boolean("isVisible").default(true).notNull(), // إظهار/إخفاء الشارة
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

/**
 * جدول شارات الطلاب
 */
export const studentBadges = mysqlTable("studentBadges", {
  id: int("id").autoincrement().primaryKey(),
  studentId: int("studentId").notNull(),
  badgeId: int("badgeId").notNull(),
  earnedAt: timestamp("earnedAt").defaultNow().notNull(),
});

/**
 * جدول النقاط والإنجازات
 */
export const studentPoints = mysqlTable("studentPoints", {
  id: int("id").autoincrement().primaryKey(),
  studentId: int("studentId").notNull().unique(),
  totalPoints: int("totalPoints").default(0),
  artworksCount: int("artworksCount").default(0),
  challengesCompleted: int("challengesCompleted").default(0),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

/**
 * جدول التقييمات والتعليقات
 */
export const reviews = mysqlTable("reviews", {
  id: int("id").autoincrement().primaryKey(),
  artworkId: int("artworkId").notNull(),
  teacherId: int("teacherId").notNull(),
  rating: int("rating"), // تقييم من 1-5
  comment: text("comment"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

/**
 * جدول الحضور والمشاركة اليومية
 */
export const dailyAttendance = mysqlTable("dailyAttendance", {
  id: int("id").autoincrement().primaryKey(),
  classId: int("classId").notNull(),
  studentId: int("studentId").notNull(),
  date: timestamp("date").notNull(),
  attendance: mysqlEnum("attendance", ["present", "absent", "late"]).default("present"),
  hasTools: boolean("hasTools").default(true), // إحضار الأدوات الفنية
  participation: boolean("participation").default(true), // المشاركة
  behavior: boolean("behavior").default(true), // السلوك
  notes: text("notes"), // ملاحظات المعلم
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

/**
 * جدول التصويت على الأعمال الفنية
 */
export const artworkVotes = mysqlTable("artworkVotes", {
  id: int("id").autoincrement().primaryKey(),
  artworkId: int("artworkId").notNull(),
  userId: int("userId").notNull(), // المستخدم الذي صوت
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

/**
 * جدول الدرجات النهائية
 */
export const studentGrades = mysqlTable("studentGrades", {
  id: int("id").autoincrement().primaryKey(),
  classId: int("classId").notNull(),
  studentId: int("studentId").notNull(),
  participationGrade: int("participationGrade").default(0), // درجة المشاركة
  toolsGrade: int("toolsGrade").default(0), // درجة الأدوات
  behaviorGrade: int("behaviorGrade").default(0), // درجة السلوك
  examGrade: int("examGrade").default(0), // درجة الاختبار
  artworkGrade: int("artworkGrade").default(0), // درجة الأعمال الفنية
  finalGrade: int("finalGrade").default(0), // الدرجة النهائية
  status: mysqlEnum("status", ["excellent", "very_good", "good", "acceptable", "weak"]),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

/**
 * جدول البيانات الشخصية للمعلمين
 */
export const teacherProfiles = mysqlTable("teacherProfiles", {
  id: int("id").autoincrement().primaryKey(),
  teacherId: int("teacherId").notNull().unique(),
  teacherName: varchar("teacherName", { length: 255 }),
  teacherDisplayName: varchar("teacherDisplayName", { length: 255 }),
  teacherGender: mysqlEnum("teacherGender", ["male", "female"]),
  teacherSignature: text("teacherSignature"),
  schoolName: varchar("schoolName", { length: 255 }),
  schoolType: mysqlEnum("schoolType", ["boys", "girls"]),
  educationOffice: varchar("educationOffice", { length: 255 }),
  educationLevel: varchar("educationLevel", { length: 100 }),
  principalDisplayName: varchar("principalDisplayName", { length: 255 }),
  principalGender: mysqlEnum("principalGender", ["male", "female"]),
  principalSignature: text("principalSignature"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

/**
 * جدول باقات الاشتراك
 */
export const subscriptionPlans = mysqlTable(
  "subscription_plans",
  {
    id: int("id").autoincrement().primaryKey(),
    code: varchar("code", { length: 100 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    priceMonthly: int("priceMonthly").default(0).notNull(),
    priceYearly: int("priceYearly").default(0).notNull(),
    currency: varchar("currency", { length: 8 }).default("SAR").notNull(),
    maxStudents: int("maxStudents").default(0).notNull(),
    maxLessons: int("maxLessons").default(0).notNull(),
    maxStorageMb: int("maxStorageMb").default(0).notNull(),
    features: text("features"),
    isActive: boolean("isActive").default(true).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => [
    uniqueIndex("uq_subscription_plans_code").on(table.code),
    index("idx_subscription_plans_active").on(table.isActive),
  ]
);

/**
 * جدول اشتراكات المعلمين
 */
export const teacherSubscriptions = mysqlTable(
  "teacher_subscriptions",
  {
    id: int("id").autoincrement().primaryKey(),
    teacherId: int("teacherId").notNull().references(() => users.id, { onDelete: "cascade" }),
    planId: int("planId").notNull().references(() => subscriptionPlans.id, { onDelete: "restrict" }),
    status: mysqlEnum("status", ["trialing", "active", "past_due", "canceled", "expired", "manual"]).notNull(),
    source: mysqlEnum("source", ["manual", "moyasar", "tap", "admin_grant"]).default("manual").notNull(),
    startsAt: timestamp("startsAt").notNull(),
    currentPeriodStart: timestamp("currentPeriodStart").notNull(),
    currentPeriodEnd: timestamp("currentPeriodEnd").notNull(),
    trialEndsAt: timestamp("trialEndsAt"),
    canceledAt: timestamp("canceledAt"),
    providerCustomerId: varchar("providerCustomerId", { length: 191 }),
    providerSubscriptionId: varchar("providerSubscriptionId", { length: 191 }),
    notes: text("notes"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => [
    index("idx_teacher_subscriptions_teacher").on(table.teacherId),
    index("idx_teacher_subscriptions_status").on(table.status),
    index("idx_teacher_subscriptions_end").on(table.currentPeriodEnd),
  ]
);

/**
 * جدول سجل أحداث الاشتراك
 */
export const subscriptionEvents = mysqlTable(
  "subscription_events",
  {
    id: int("id").autoincrement().primaryKey(),
    teacherSubscriptionId: int("teacherSubscriptionId")
      .notNull()
      .references(() => teacherSubscriptions.id, { onDelete: "cascade" }),
    eventType: varchar("eventType", { length: 120 }).notNull(),
    payload: text("payload"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => [index("idx_subscription_events_subscription").on(table.teacherSubscriptionId, table.createdAt)]
);

/**
 * جدول أكواد تفعيل الاشتراك
 */
export const subscriptionActivationCodes = mysqlTable(
  "subscription_activation_codes",
  {
    id: int("id").autoincrement().primaryKey(),
    code: varchar("code", { length: 120 }).notNull(),
    planId: int("planId").notNull().references(() => subscriptionPlans.id, { onDelete: "restrict" }),
    status: mysqlEnum("status", ["active", "used", "expired", "disabled"]).default("active").notNull(),
    durationDays: int("durationDays").default(30).notNull(),
    maxRedemptions: int("maxRedemptions").default(1).notNull(),
    redeemedCount: int("redeemedCount").default(0).notNull(),
    startsAt: timestamp("startsAt"),
    expiresAt: timestamp("expiresAt"),
    createdByAdminId: int("createdByAdminId").references(() => users.id, { onDelete: "set null" }),
    notes: text("notes"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => [
    uniqueIndex("uq_subscription_activation_codes_code").on(table.code),
    index("idx_subscription_activation_codes_status").on(table.status),
    index("idx_subscription_activation_codes_plan").on(table.planId),
  ]
);

export const supportRequests = mysqlTable(
  "support_requests",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").references(() => users.id, { onDelete: "set null" }),
    role: mysqlEnum("role", ["guest", "user", "admin", "teacher", "student"]).default("guest").notNull(),
    requestType: mysqlEnum("requestType", ["subscription_help", "password_reset", "technical_support", "account_issue", "other"]).notNull(),
    title: varchar("title", { length: 191 }),
    message: text("message").notNull(),
    requesterName: varchar("requesterName", { length: 255 }),
    contactEmail: varchar("contactEmail", { length: 255 }),
    contactPhone: varchar("contactPhone", { length: 50 }),
    status: mysqlEnum("status", ["new", "in_progress", "resolved", "rejected", "closed"]).default("new").notNull(),
    adminNotes: text("adminNotes"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
    resolvedAt: timestamp("resolvedAt"),
  },
  (table) => [
    index("idx_support_requests_user_id").on(table.userId),
    index("idx_support_requests_status").on(table.status),
    index("idx_support_requests_request_type").on(table.requestType),
  ]
);

/**
 * جدول قالب ونصوص الشهادة لكل معلم
 */
export const certificateTemplates = mysqlTable("certificateTemplates", {
  id: int("id").autoincrement().primaryKey(),
  teacherId: int("teacherId").notNull().unique().references(() => users.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 255 }).notNull(),
  mainText: text("mainText").notNull(),
  congratsText: text("congratsText"),
  footerText: text("footerText"),
  issuerName: varchar("issuerName", { length: 255 }),
  backgroundUrl: text("backgroundUrl"),
  ministryLogoUrl: text("ministryLogoUrl"),
  schoolLogoUrl: text("schoolLogoUrl"),
  showTeacherSignature: boolean("showTeacherSignature").default(true).notNull(),
  showPrincipalSignature: boolean("showPrincipalSignature").default(true).notNull(),
  showMinistryLogo: boolean("showMinistryLogo").default(true).notNull(),
  showSchoolLogo: boolean("showSchoolLogo").default(true).notNull(),
  showLogo: boolean("showLogo").default(false).notNull(),
  ministryLogoAlign: mysqlEnum("ministryLogoAlign", ["right", "center", "left"]).default("right").notNull(),
  schoolLogoAlign: mysqlEnum("schoolLogoAlign", ["right", "center", "left"]).default("left").notNull(),
  titleAlign: mysqlEnum("titleAlign", ["top", "center"]).default("top").notNull(),
  nameAlign: mysqlEnum("nameAlign", ["center", "right"]).default("center").notNull(),
  titleFontSize: int("titleFontSize").default(46).notNull(),
  studentNameFontSize: int("studentNameFontSize").default(47).notNull(),
  pathNameFontSize: int("pathNameFontSize").default(33).notNull(),
  mainTextFontSize: int("mainTextFontSize").default(27).notNull(),
  congratsTextFontSize: int("congratsTextFontSize").default(27).notNull(),
  footerTextFontSize: int("footerTextFontSize").default(20).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

/**
 * جدول تقييمات الدروس
 */
export const lessonRatings = mysqlTable("lessonRatings", {
  id: int("id").autoincrement().primaryKey(),
  lessonId: int("lessonId").notNull(),
  userId: int("userId").notNull(),
  rating: int("rating").notNull(), // 1-5 نجوم
  comment: text("comment"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

/**
 * جدول المسارات التعليمية
 */
export const learningPaths = mysqlTable(
  "learningPaths",
  {
    id: int("id").autoincrement().primaryKey(),
    title: varchar("title", { length: 255 }).notNull(),
    description: text("description"),
    contentScope: mysqlEnum("contentScope", CONTENT_SCOPE_VALUES).default("teacher").notNull(),
    ownerTeacherId: int("ownerTeacherId").references(() => users.id, { onDelete: "set null" }),
    createdByUserId: int("createdByUserId").references(() => users.id, { onDelete: "set null" }),
    sourcePathId: int("sourcePathId"),
    importJobId: int("importJobId"),
    stageId: int("stageId").references(() => academicStages.id, { onDelete: "set null" }),
    gradeId: int("gradeId").references(() => academicGrades.id, { onDelete: "set null" }),
    termId: int("termId").references(() => academicTerms.id, { onDelete: "set null" }),
    subjectId: int("subjectId").references(() => subjects.id, { onDelete: "set null" }),
    gradeLabelRaw: varchar("gradeLabelRaw", { length: 120 }),
    termLabelRaw: varchar("termLabelRaw", { length: 120 }),
    subjectLabelRaw: varchar("subjectLabelRaw", { length: 120 }),
    teacherId: int("teacherId").notNull(),
    grade: varchar("grade", { length: 50 }),
    classId: int("classId"), // الفصل المستهدف (اختياري)
    isVisible: boolean("isVisible").default(true), // إظهار/إخفاء المسار للطلاب
    category: mysqlEnum("category", ["drawing", "decoration", "colors", "texture"]).notNull(),
    imageUrl: text("imageUrl"),
    order: int("order").default(0),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => [
    index("idx_paths_scope_owner").on(table.contentScope, table.ownerTeacherId),
    index("idx_paths_canonical").on(table.stageId, table.gradeId, table.termId, table.subjectId),
    index("idx_paths_source").on(table.sourcePathId),
  ]
);

/**
 * جدول ربط الدروس بالمسارات
 */
export const pathLessons = mysqlTable("pathLessons", {
  id: int("id").autoincrement().primaryKey(),
  pathId: int("pathId").notNull(),
  lessonId: int("lessonId").notNull(),
  order: int("order").notNull(), // ترتيب الدرس في المسار
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

/**
 * جدول تتبع تقدم الطلاب في المسارات
 */
export const studentProgress = mysqlTable("studentProgress", {
  id: int("id").autoincrement().primaryKey(),
  studentId: int("studentId").notNull(),
  pathId: int("pathId").notNull(),
  lessonId: int("lessonId").notNull(),
  completed: boolean("completed").default(false),
  completedAt: timestamp("completedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

/**
 * جدول المستخدمين المحظورين/المحذوفين
 */
export const bannedUsers = mysqlTable("bannedUsers", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  reason: text("reason"), // سبب الحظر
  bannedAt: timestamp("bannedAt").defaultNow().notNull(),
  bannedBy: varchar("bannedBy", { length: 64 }), // openId للمسؤول عن الحظر
});

/**
 * سجل عمليات الإدارة
 */
export const adminActivityLogs = mysqlTable("adminActivityLogs", {
  id: int("id").autoincrement().primaryKey(),
  adminOpenId: varchar("adminOpenId", { length: 64 }).notNull(),
  action: varchar("action", { length: 64 }).notNull(),
  targetOpenId: varchar("targetOpenId", { length: 64 }),
  details: text("details"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

/**
 * جدول تتبع مهام الصيانة (حالة دائمة قابلة للاسترجاع بعد إعادة التشغيل)
 */
export const maintenanceJobs = mysqlTable("maintenanceJobs", {
  id: varchar("id", { length: 64 }).primaryKey(),
  task: varchar("task", { length: 80 }).notNull(),
  command: text("command").notNull(),
  status: mysqlEnum("status", ["running", "success", "failed", "interrupted"]).default("running").notNull(),
  progress: int("progress").default(0).notNull(),
  outputLog: text("outputLog").notNull(),
  errorMessage: text("errorMessage"),
  exitCode: int("exitCode"),
  startedAt: timestamp("startedAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  finishedAt: timestamp("finishedAt"),
  startedByOpenId: varchar("startedByOpenId", { length: 64 }),
});

/**
 * جدول الاختبارات
 */
export const quizzes = mysqlTable(
  "quizzes",
  {
    id: int("id").autoincrement().primaryKey(),
    lessonId: int("lessonId").notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    description: text("description"),
    contentScope: mysqlEnum("contentScope", CONTENT_SCOPE_VALUES).default("teacher").notNull(),
    ownerTeacherId: int("ownerTeacherId").references(() => users.id, { onDelete: "set null" }),
    createdByUserId: int("createdByUserId").references(() => users.id, { onDelete: "set null" }),
    sourceQuizId: int("sourceQuizId"),
    importJobId: int("importJobId"),
    stageId: int("stageId").references(() => academicStages.id, { onDelete: "set null" }),
    gradeId: int("gradeId").references(() => academicGrades.id, { onDelete: "set null" }),
    termId: int("termId").references(() => academicTerms.id, { onDelete: "set null" }),
    subjectId: int("subjectId").references(() => subjects.id, { onDelete: "set null" }),
    gradeLabelRaw: varchar("gradeLabelRaw", { length: 120 }),
    termLabelRaw: varchar("termLabelRaw", { length: 120 }),
    subjectLabelRaw: varchar("subjectLabelRaw", { length: 120 }),
    questions: text("questions").notNull(), // JSON array of questions
    passingScore: int("passingScore").default(60), // الدرجة المطلوبة للنجاح
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => [
    index("idx_quizzes_scope_owner").on(table.contentScope, table.ownerTeacherId),
    index("idx_quizzes_canonical").on(table.stageId, table.gradeId, table.termId, table.subjectId),
    index("idx_quizzes_source").on(table.sourceQuizId),
  ]
);

/**
 * جدول واجبات الدروس
 */
export const lessonAssignments = mysqlTable("lessonAssignments", {
  id: int("id").autoincrement().primaryKey(),
  lessonId: int("lessonId").notNull(),
  teacherId: int("teacherId").notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  dueDate: timestamp("dueDate"),
  isPublished: boolean("isPublished").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

/**
 * جدول نتائج الاختبارات
 */
export const quizResults = mysqlTable("quizResults", {
  id: int("id").autoincrement().primaryKey(),
  quizId: int("quizId").notNull(),
  studentId: int("studentId").notNull(),
  score: int("score").notNull(), // الدرجة المحصلة
  totalQuestions: int("totalQuestions").notNull(), // عدد الأسئلة
  correctAnswers: int("correctAnswers").notNull(), // عدد الإجابات الصحيحة
  answers: text("answers").notNull(), // JSON array of answers
  passed: boolean("passed").default(false), // هل نجح في الاختبار
  completedAt: timestamp("completedAt").defaultNow().notNull(),
});

/**
 * جدول الإشعارات
 */
export const notifications = mysqlTable("notifications", {
  id: int("id").autoincrement().primaryKey(),
  studentId: int("studentId").notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  message: text("message").notNull(),
  type: mysqlEnum("type", ["lesson", "grade", "quiz", "achievement", "general"]).notNull(),
  read: boolean("read").default(false),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

/**
 * جدول الشهادات
 */
export const certificates = mysqlTable("certificates", {
  id: int("id").autoincrement().primaryKey(),
  studentId: int("studentId").notNull(),
  pathId: int("pathId"), // رقم المسار (إذا كانت شهادة مسار)
  certificateNumber: varchar("certificateNumber", { length: 50 }).notNull().unique(),
  studentName: varchar("studentName", { length: 255 }).notNull(),
  title: varchar("title", { length: 255 }).notNull(), // عنوان الشهادة
  description: text("description"), // وصف الإنجاز
  issueType: mysqlEnum("issueType", ["auto", "manual"]).default("auto").notNull(),
  status: mysqlEnum("status", ["earned", "granted"]).default("earned").notNull(),
  issuedByUserId: int("issuedByUserId").references(() => users.id, { onDelete: "set null" }),
  templateVersion: int("templateVersion").default(1).notNull(),
  snapshotJson: text("snapshotJson"),
  issueDate: timestamp("issueDate").defaultNow().notNull(),
  pdfUrl: text("pdfUrl"), // رابط ملف PDF
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

/**
 * جدول إعدادات الدرجات للمعلم
 */
export const gradeSettings = mysqlTable("gradeSettings", {
  id: int("id").autoincrement().primaryKey(),
  teacherId: int("teacherId").notNull(),
  grade1Name: varchar("grade1Name", { length: 100 }).default("المشاركة"),
  grade1Value: int("grade1Value").default(20),
  grade2Name: varchar("grade2Name", { length: 100 }).default("الأدوات"),
  grade2Value: int("grade2Value").default(10),
  grade3Name: varchar("grade3Name", { length: 100 }).default("السلوك"),
  grade3Value: int("grade3Value").default(10),
  grade4Name: varchar("grade4Name", { length: 100 }).default("الاختبار"),
  grade4Value: int("grade4Value").default(30),
  grade5Name: varchar("grade5Name", { length: 100 }).default("الأعمال الفنية"),
  grade5Value: int("grade5Value").default(30),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

/**
 * جدول الموهوبين
 */
export const giftedStudents = mysqlTable("giftedStudents", {
  id: int("id").autoincrement().primaryKey(),
  studentId: int("studentId").notNull(),
  teacherId: int("teacherId").notNull(),
  talentField: varchar("talentField", { length: 100 }).notNull(), // مجال الموهبة
  description: text("description"), // وصف الموهبة
  enrichmentPrograms: text("enrichmentPrograms"), // البرامج الإثرائية (JSON)
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

/**
 * جدول إعدادات صفحة عن المنصة
 */
export const aboutPageSettings = mysqlTable("aboutPageSettings", {
  id: int("id").autoincrement().primaryKey(),
  heroTitle: varchar("heroTitle", { length: 255 }).notNull(),
  heroDescription: text("heroDescription").notNull(),
  mediaType: mysqlEnum("mediaType", ["video", "image"]).default("video").notNull(),
  mediaUrl: text("mediaUrl").notNull(),
  mediaTitle: varchar("mediaTitle", { length: 255 }).notNull(),
  mediaDescription: text("mediaDescription"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

/**
 * جدول إعدادات العرض التنفيذي
 */
export const showcaseSettings = mysqlTable("showcaseSettings", {
  id: int("id").primaryKey(),
  heroTitle: varchar("heroTitle", { length: 255 }).notNull(),
  heroDescription: text("heroDescription").notNull(),
  badgeLabel: varchar("badgeLabel", { length: 255 }).notNull(),
  closingNote: text("closingNote").notNull(),
  journeyStepsJson: text("journeyStepsJson").notNull(),
  componentCardsJson: text("componentCardsJson").notNull(),
  impactPointsJson: text("impactPointsJson").notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

/**
 * جدول إعدادات معرض الموقع العام
 */
export const siteGallerySettings = mysqlTable("siteGallerySettings", {
  id: int("id").primaryKey(),
  heroTitle: varchar("heroTitle", { length: 255 }).notNull(),
  heroDescription: text("heroDescription").notNull(),
  heroBadge: varchar("heroBadge", { length: 255 }).notNull(),
  heroImageUrl: text("heroImageUrl").notNull(),
  categoriesJson: text("categoriesJson").notNull(),
  emptyTitle: varchar("emptyTitle", { length: 255 }).notNull(),
  emptyDescription: text("emptyDescription").notNull(),
  imageErrorTitle: varchar("imageErrorTitle", { length: 255 }).notNull(),
  imageErrorDescription: text("imageErrorDescription").notNull(),
  slideshowEnabled: boolean("slideshowEnabled").default(true).notNull(),
  slideshowIntervalSeconds: int("slideshowIntervalSeconds").default(5).notNull(),
  slideshowShowDetails: boolean("slideshowShowDetails").default(false).notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

/**
 * جدول إعدادات معرض المعلم العام
 */
export const teacherGallerySettings = mysqlTable(
  "teacherGallerySettings",
  {
    id: int("id").autoincrement().primaryKey(),
    teacherId: int("teacherId").notNull().unique(),
    enabled: boolean("enabled").default(true).notNull(),
    heroTitle: varchar("heroTitle", { length: 255 }).notNull(),
    heroDescription: text("heroDescription").notNull(),
    headerImageUrl: text("headerImageUrl").notNull(),
    featuredArtworkIdsJson: text("featuredArtworkIdsJson").notNull(),
    imageErrorTitle: varchar("imageErrorTitle", { length: 255 }).notNull(),
    imageErrorDescription: text("imageErrorDescription").notNull(),
    visibility: mysqlEnum("visibility", ["private", "unlisted", "public"]).default("private").notNull(),
    shareSlug: varchar("shareSlug", { length: 96 }),
    shareEnabled: boolean("shareEnabled").default(false).notNull(),
    showArtistName: boolean("showArtistName").default(true).notNull(),
    allowPublicViewing: boolean("allowPublicViewing").default(false).notNull(),
    slideshowEnabled: boolean("slideshowEnabled").default(true).notNull(),
    slideshowIntervalSeconds: int("slideshowIntervalSeconds").default(5).notNull(),
    slideshowShowDetails: boolean("slideshowShowDetails").default(false).notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => [index("idx_teacherGallerySettings_teacherId").on(table.teacherId)]
);

/**
 * جدول إعدادات معرض الفصل
 */
export const classGallerySettings = mysqlTable(
  "classGallerySettings",
  {
    id: int("id").autoincrement().primaryKey(),
    classId: int("classId").notNull().unique(),
    enabled: boolean("enabled").default(true).notNull(),
    heroTitle: varchar("heroTitle", { length: 255 }).notNull(),
    heroDescription: text("heroDescription").notNull(),
    headerImageUrl: text("headerImageUrl").notNull(),
    featuredArtworkIdsJson: text("featuredArtworkIdsJson").notNull(),
    imageErrorTitle: varchar("imageErrorTitle", { length: 255 }).notNull(),
    imageErrorDescription: text("imageErrorDescription").notNull(),
    visibility: mysqlEnum("visibility", ["private", "unlisted", "public"]).default("private").notNull(),
    shareSlug: varchar("shareSlug", { length: 96 }),
    shareEnabled: boolean("shareEnabled").default(false).notNull(),
    showStudentNames: boolean("showStudentNames").default(true).notNull(),
    showArtistName: boolean("showArtistName").default(true).notNull(),
    allowPublicViewing: boolean("allowPublicViewing").default(false).notNull(),
    slideshowEnabled: boolean("slideshowEnabled").default(true).notNull(),
    slideshowIntervalSeconds: int("slideshowIntervalSeconds").default(5).notNull(),
    slideshowShowDetails: boolean("slideshowShowDetails").default(false).notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => [index("idx_classGallerySettings_classId").on(table.classId)]
);

/**
 * إعدادات مشاركة معرض الطالب (عامة بالرابط)
 */
export const studentGallerySettings = mysqlTable(
  "studentGallerySettings",
  {
    id: int("id").autoincrement().primaryKey(),
    studentId: int("studentId").notNull().unique(),
    teacherId: int("teacherId").notNull(),
    classId: int("classId"),
    visibility: mysqlEnum("visibility", ["private", "unlisted", "public"]).default("private").notNull(),
    shareSlug: varchar("shareSlug", { length: 96 }),
    shareEnabled: boolean("shareEnabled").default(false).notNull(),
    showStudentName: boolean("showStudentName").default(true).notNull(),
    showFirstNameOnly: boolean("showFirstNameOnly").default(false).notNull(),
    showClassName: boolean("showClassName").default(true).notNull(),
    showSchoolName: boolean("showSchoolName").default(false).notNull(),
    showBadges: boolean("showBadges").default(true).notNull(),
    showCertificates: boolean("showCertificates").default(false).notNull(),
    showVotes: boolean("showVotes").default(true).notNull(),
    allowPublicViewing: boolean("allowPublicViewing").default(false).notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => [
    index("idx_studentGallerySettings_teacherId").on(table.teacherId),
    index("idx_studentGallerySettings_classId").on(table.classId),
    uniqueIndex("studentGallerySettings_shareSlug_unique").on(table.shareSlug),
  ]
);

/**
 * جدول الأصول المرفوعة (داخلي/خارجي)
 */
export const uploadedAssets = mysqlTable("uploadedAssets", {
  id: int("id").autoincrement().primaryKey(),
  provider: varchar("provider", { length: 32 }).default("spaces").notNull(),
  bucket: varchar("bucket", { length: 191 }),
  objectKey: text("objectKey"),
  publicUrl: text("publicUrl").notNull(),
  mimeType: varchar("mimeType", { length: 191 }),
  fileSize: int("fileSize"),
  etag: varchar("etag", { length: 191 }),
  sourceType: varchar("sourceType", { length: 64 }).default("unknown").notNull(),
  ownershipContext: varchar("ownershipContext", { length: 191 }),
  uploadedVia: mysqlEnum("uploadedVia", ["internal", "external"]).default("internal").notNull(),
  isExternal: boolean("isExternal").default(false).notNull(),
  manualKeep: boolean("manualKeep").default(false).notNull(),
  status: mysqlEnum("status", ["active", "deleted", "orphaned", "legacy_unknown_key"]).default("active").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

/**
 * جدول ربط الأصول بالكيانات (دروس/عن المنصة/أعمال فنية...)
 */
export const uploadedAssetReferences = mysqlTable("uploadedAssetReferences", {
  id: int("id").autoincrement().primaryKey(),
  assetId: int("assetId").notNull(),
  entityType: varchar("entityType", { length: 64 }).notNull(),
  entityId: int("entityId").notNull(),
  fieldName: varchar("fieldName", { length: 64 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

/**
 * جدول إعدادات دخول المدير
 */
export const adminAuthSettings = mysqlTable("adminAuthSettings", {
  id: int("id").autoincrement().primaryKey(),
  username: varchar("username", { length: 191 }).notNull().unique(),
  passwordHash: text("passwordHash").notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

/**
 * جدول تتبع وظائف استيراد المحتوى من ملفات PDF
 */
export const contentImportJobs = mysqlTable("contentImportJobs", {
  id: int("id").autoincrement().primaryKey(),
  fileName: varchar("fileName", { length: 255 }).notNull(),
  storageKey: text("storageKey").notNull(),
  storageUrl: text("storageUrl").notNull(),
  grade: varchar("grade", { length: 100 }).notNull(),
  subject: varchar("subject", { length: 255 }).notNull(),
  title: varchar("title", { length: 255 }),
  status: mysqlEnum("status", ["uploaded", "analyzing", "preview_ready", "ocr_required", "approved", "imported", "failed"]).default("uploaded").notNull(),
  pageCount: int("pageCount").default(0).notNull(),
  extractedPathsCount: int("extractedPathsCount").default(0).notNull(),
  extractedLessonsCount: int("extractedLessonsCount").default(0).notNull(),
  extractedChallengesCount: int("extractedChallengesCount").default(0).notNull(),
  extractedQuizzesCount: int("extractedQuizzesCount").default(0).notNull(),
  previewPayload: text("previewPayload"),
  errorMessage: text("errorMessage"),
  createdBy: int("createdBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

/**
 * جدول مهام استيراد الفيديو (Phase 1)
 */
export const videoImportJobs = mysqlTable(
  "videoImportJobs",
  {
    id: int("id").autoincrement().primaryKey(),
    sourceUrl: text("sourceUrl").notNull(),
    sourceType: varchar("sourceType", { length: 64 }).notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    lessonId: int("lessonId"),
    requestedByUserId: int("requestedByUserId").notNull(),
    rightsConfirmed: boolean("rightsConfirmed").default(false).notNull(),
    status: mysqlEnum("status", ["queued", "downloading", "completed", "failed", "cancelled"]).default("queued").notNull(),
    metubeTaskId: varchar("metubeTaskId", { length: 191 }),
    outputPath: text("outputPath"),
    fileName: varchar("fileName", { length: 255 }),
    fileExtension: varchar("fileExtension", { length: 32 }),
    fileSize: int("fileSize"),
    mimeType: varchar("mimeType", { length: 191 }),
    storageProvider: varchar("storageProvider", { length: 32 }),
    remoteObjectKey: text("remoteObjectKey"),
    remoteBucket: varchar("remoteBucket", { length: 191 }),
    remoteUrl: text("remoteUrl"),
    finalizedFrom: mysqlEnum("finalizedFrom", ["local", "spaces"]),
    uploadedAssetId: int("uploadedAssetId"),
    errorMessage: text("errorMessage"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
    completedAt: timestamp("completedAt"),
    importedAt: timestamp("importedAt"),
  },
  (table) => [
    index("idx_videoImportJobs_status_createdAt").on(table.status, table.createdAt),
    index("idx_videoImportJobs_requestedByUserId").on(table.requestedByUserId),
    index("idx_videoImportJobs_lessonId").on(table.lessonId),
    index("idx_videoImportJobs_uploadedAssetId").on(table.uploadedAssetId),
  ]
);

/**
 * جدول ربط الفيديوهات المستوردة بالدروس (Phase 4)
 */
export const lessonVideoAssets = mysqlTable(
  "lessonVideoAssets",
  {
    id: int("id").autoincrement().primaryKey(),
    lessonId: int("lessonId").notNull(),
    uploadedAssetId: int("uploadedAssetId").notNull(),
    title: varchar("title", { length: 255 }),
    displayOrder: int("displayOrder").default(0).notNull(),
    startSeconds: int("startSeconds"),
    endSeconds: int("endSeconds"),
    isPrimary: boolean("isPrimary").default(false).notNull(),
    isPublished: boolean("isPublished").default(false).notNull(),
    visibleToStudents: boolean("visibleToStudents").default(false).notNull(),
    publishedAt: timestamp("publishedAt"),
    publishedByUserId: int("publishedByUserId").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => [
    index("idx_lessonVideoAssets_lessonId").on(table.lessonId),
    index("idx_lessonVideoAssets_uploadedAssetId").on(table.uploadedAssetId),
    index("idx_lessonVideoAssets_lesson_primary").on(table.lessonId, table.isPrimary),
    index("idx_lessonVideoAssets_lesson_order").on(table.lessonId, table.displayOrder),
    index("idx_lessonVideoAssets_student_visibility").on(table.lessonId, table.isPublished, table.visibleToStudents),
    uniqueIndex("idx_lessonVideoAssets_unique_link").on(table.lessonId, table.uploadedAssetId),
  ]
);

/**
 * جدول تتبع مصدر الكيانات المستوردة ومنع التكرار
 */
export const contentSourceRecords = mysqlTable("contentSourceRecords", {
  id: int("id").autoincrement().primaryKey(),
  importJobId: int("importJobId").notNull(),
  entityType: mysqlEnum("entityType", ["path", "lesson", "challenge", "quiz"]).notNull(),
  entityId: int("entityId").notNull(),
  sourceType: varchar("sourceType", { length: 32 }).default("pdf").notNull(),
  sourceKey: text("sourceKey").notNull(),
  sourceFileName: varchar("sourceFileName", { length: 255 }).notNull(),
  sourceFingerprint: varchar("sourceFingerprint", { length: 191 }).notNull().unique(),
  normalizedTitle: varchar("normalizedTitle", { length: 255 }).notNull(),
  pageFrom: int("pageFrom"),
  pageTo: int("pageTo"),
  extractionMode: mysqlEnum("extractionMode", ["structured", "fallback_split"]).notNull(),
  confidence: int("confidence"),
  metadata: text("metadata"),
  createdByPipeline: boolean("createdByPipeline").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

/**
 * جداول الأبعاد المعيارية (Phase 2)
 */
export const academicStages = mysqlTable("academicStages", {
  id: int("id").autoincrement().primaryKey(),
  code: varchar("code", { length: 64 }).notNull().unique(),
  nameAr: varchar("nameAr", { length: 120 }).notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  sortOrder: int("sortOrder").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const academicGrades = mysqlTable(
  "academicGrades",
  {
    id: int("id").autoincrement().primaryKey(),
    stageId: int("stageId").references(() => academicStages.id, { onDelete: "cascade" }).notNull(),
    code: varchar("code", { length: 64 }).notNull().unique(),
    nameAr: varchar("nameAr", { length: 120 }).notNull(),
    isActive: boolean("isActive").default(true).notNull(),
    sortOrder: int("sortOrder").default(0).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => [index("idx_academicGrades_stageId").on(table.stageId)]
);

export const academicTerms = mysqlTable("academicTerms", {
  id: int("id").autoincrement().primaryKey(),
  code: varchar("code", { length: 64 }).notNull().unique(),
  nameAr: varchar("nameAr", { length: 120 }).notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  sortOrder: int("sortOrder").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const subjects = mysqlTable("subjects", {
  id: int("id").autoincrement().primaryKey(),
  code: varchar("code", { length: 64 }).notNull().unique(),
  nameAr: varchar("nameAr", { length: 120 }).notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  sortOrder: int("sortOrder").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const gradeAliases = mysqlTable(
  "gradeAliases",
  {
    id: int("id").autoincrement().primaryKey(),
    alias: varchar("alias", { length: 120 }).notNull().unique(),
    normalizedAlias: varchar("normalizedAlias", { length: 120 }).notNull().unique(),
    gradeId: int("gradeId").references(() => academicGrades.id, { onDelete: "cascade" }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => [index("idx_gradeAliases_gradeId").on(table.gradeId)]
);

export const termAliases = mysqlTable(
  "termAliases",
  {
    id: int("id").autoincrement().primaryKey(),
    alias: varchar("alias", { length: 120 }).notNull().unique(),
    normalizedAlias: varchar("normalizedAlias", { length: 120 }).notNull().unique(),
    termId: int("termId").references(() => academicTerms.id, { onDelete: "cascade" }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => [index("idx_termAliases_termId").on(table.termId)]
);

export const subjectAliases = mysqlTable(
  "subjectAliases",
  {
    id: int("id").autoincrement().primaryKey(),
    alias: varchar("alias", { length: 120 }).notNull().unique(),
    normalizedAlias: varchar("normalizedAlias", { length: 120 }).notNull().unique(),
    subjectId: int("subjectId").references(() => subjects.id, { onDelete: "cascade" }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => [index("idx_subjectAliases_subjectId").on(table.subjectId)]
);

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type Class = typeof classes.$inferSelect;
export type InsertClass = typeof classes.$inferInsert;
export type ClassStudent = typeof classStudents.$inferSelect;
export type InsertClassStudent = typeof classStudents.$inferInsert;
export type Artwork = typeof artworks.$inferSelect;
export type InsertArtwork = typeof artworks.$inferInsert;
export type Competition = typeof competitions.$inferSelect;
export type InsertCompetition = typeof competitions.$inferInsert;
export type CompetitionArtworkVote = typeof competitionArtworkVotes.$inferSelect;
export type InsertCompetitionArtworkVote = typeof competitionArtworkVotes.$inferInsert;
export type TeacherCompetition = typeof teacherCompetitions.$inferSelect;
export type InsertTeacherCompetition = typeof teacherCompetitions.$inferInsert;
export type CompetitionSubmission = typeof competitionSubmissions.$inferSelect;
export type InsertCompetitionSubmission = typeof competitionSubmissions.$inferInsert;
export type ArtworkAiFeedback = typeof artworkAiFeedback.$inferSelect;
export type InsertArtworkAiFeedback = typeof artworkAiFeedback.$inferInsert;
export type Lesson = typeof lessons.$inferSelect;
export type InsertLesson = typeof lessons.$inferInsert;
export type Challenge = typeof challenges.$inferSelect;
export type InsertChallenge = typeof challenges.$inferInsert;
export type Badge = typeof badges.$inferSelect;
export type InsertBadge = typeof badges.$inferInsert;
export type StudentBadge = typeof studentBadges.$inferSelect;
export type StudentPoint = typeof studentPoints.$inferSelect;
export type Review = typeof reviews.$inferSelect;
export type DailyAttendance = typeof dailyAttendance.$inferSelect;
export type StudentGrade = typeof studentGrades.$inferSelect;
export type TeacherProfile = typeof teacherProfiles.$inferSelect;
export type InsertTeacherProfile = typeof teacherProfiles.$inferInsert;
export type CertificateTemplate = typeof certificateTemplates.$inferSelect;
export type InsertCertificateTemplate = typeof certificateTemplates.$inferInsert;
export type LessonRating = typeof lessonRatings.$inferSelect;
export type InsertLessonRating = typeof lessonRatings.$inferInsert;
export type LearningPath = typeof learningPaths.$inferSelect;
export type InsertLearningPath = typeof learningPaths.$inferInsert;
export type PathLesson = typeof pathLessons.$inferSelect;
export type InsertPathLesson = typeof pathLessons.$inferInsert;
export type StudentProgress = typeof studentProgress.$inferSelect;
export type InsertStudentProgress = typeof studentProgress.$inferInsert;
export type Quiz = typeof quizzes.$inferSelect;
export type InsertQuiz = typeof quizzes.$inferInsert;
export type LessonAssignment = typeof lessonAssignments.$inferSelect;
export type InsertLessonAssignment = typeof lessonAssignments.$inferInsert;
export type QuizResult = typeof quizResults.$inferSelect;
export type InsertQuizResult = typeof quizResults.$inferInsert;
export type Notification = typeof notifications.$inferSelect;
export type InsertNotification = typeof notifications.$inferInsert;
export type Certificate = typeof certificates.$inferSelect;
export type InsertCertificate = typeof certificates.$inferInsert;
export type GradeSetting = typeof gradeSettings.$inferSelect;
export type InsertGradeSetting = typeof gradeSettings.$inferInsert;
export type GiftedStudent = typeof giftedStudents.$inferSelect;
export type InsertGiftedStudent = typeof giftedStudents.$inferInsert;
export type AboutPageSetting = typeof aboutPageSettings.$inferSelect;
export type InsertAboutPageSetting = typeof aboutPageSettings.$inferInsert;
export type ShowcaseSetting = typeof showcaseSettings.$inferSelect;
export type InsertShowcaseSetting = typeof showcaseSettings.$inferInsert;
export type SiteGallerySetting = typeof siteGallerySettings.$inferSelect;
export type InsertSiteGallerySetting = typeof siteGallerySettings.$inferInsert;
export type TeacherGallerySetting = typeof teacherGallerySettings.$inferSelect;
export type InsertTeacherGallerySetting = typeof teacherGallerySettings.$inferInsert;
export type ClassGallerySetting = typeof classGallerySettings.$inferSelect;
export type InsertClassGallerySetting = typeof classGallerySettings.$inferInsert;
export type StudentGallerySetting = typeof studentGallerySettings.$inferSelect;
export type InsertStudentGallerySetting = typeof studentGallerySettings.$inferInsert;
export type UploadedAsset = typeof uploadedAssets.$inferSelect;
export type InsertUploadedAsset = typeof uploadedAssets.$inferInsert;
export type UploadedAssetReference = typeof uploadedAssetReferences.$inferSelect;
export type InsertUploadedAssetReference = typeof uploadedAssetReferences.$inferInsert;
export type AdminAuthSetting = typeof adminAuthSettings.$inferSelect;
export type InsertAdminAuthSetting = typeof adminAuthSettings.$inferInsert;
export type MaintenanceJobRecord = typeof maintenanceJobs.$inferSelect;
export type InsertMaintenanceJobRecord = typeof maintenanceJobs.$inferInsert;
export type ContentImportJob = typeof contentImportJobs.$inferSelect;
export type InsertContentImportJob = typeof contentImportJobs.$inferInsert;
export type VideoImportJob = typeof videoImportJobs.$inferSelect;
export type InsertVideoImportJob = typeof videoImportJobs.$inferInsert;
export type LessonVideoAsset = typeof lessonVideoAssets.$inferSelect;
export type InsertLessonVideoAsset = typeof lessonVideoAssets.$inferInsert;
export type ContentSourceRecord = typeof contentSourceRecords.$inferSelect;
export type InsertContentSourceRecord = typeof contentSourceRecords.$inferInsert;
export type AcademicStage = typeof academicStages.$inferSelect;
export type InsertAcademicStage = typeof academicStages.$inferInsert;
export type AcademicGrade = typeof academicGrades.$inferSelect;
export type InsertAcademicGrade = typeof academicGrades.$inferInsert;
export type AcademicTerm = typeof academicTerms.$inferSelect;
export type InsertAcademicTerm = typeof academicTerms.$inferInsert;
export type Subject = typeof subjects.$inferSelect;
export type InsertSubject = typeof subjects.$inferInsert;
export type GradeAlias = typeof gradeAliases.$inferSelect;
export type InsertGradeAlias = typeof gradeAliases.$inferInsert;
export type TermAlias = typeof termAliases.$inferSelect;
export type InsertTermAlias = typeof termAliases.$inferInsert;
export type SubjectAlias = typeof subjectAliases.$inferSelect;
export type InsertSubjectAlias = typeof subjectAliases.$inferInsert;
