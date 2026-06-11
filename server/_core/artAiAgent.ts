import { ENV } from "./env";
import { invokeLLM } from "./llm";

export type ArtPerformanceLevel = "يحتاج دعمًا" | "في طور التحسن" | "متمكن" | "متقدم";
export type ArtCompletionStatus = "مكتمل" | "شبه مكتمل" | "غير مكتمل";
export type ArtQualityLevel = "ممتاز" | "جيد جدًا" | "جيد" | "يحتاج دعم";

export type AnalyzeStudentArtworkInput = {
  artworkId: number;
  title: string;
  description?: string | null;
  studentName?: string | null;
  gradeName?: string | null;
  className?: string | null;
  imageUrl?: string | null;
  teacherNotes?: string | null;
};

export type StudentArtworkAnalysisResult = {
  analysisSteps?: string[];
  summary: string;
  strengths: string[];
  improvements: string[];
  completionStatus: ArtCompletionStatus;
  artisticQualityLevel: ArtQualityLevel;
  performanceLevel: ArtPerformanceLevel;
  reviewAlert?: string;
  readyFeedback: string;
  suggestedActivity: string;
  studentMessage: string;
  teacherNotes: string;
};

export type StudentArtworkAnalysisResponse = {
  result: StudentArtworkAnalysisResult;
  provider: "fallback" | "llm";
  mode: "preview" | "real";
  promptVersion: "art-agent-v2";
  model: string;
  isFallback: boolean;
  lastErrorType?: ArtAiAgentErrorType;
};

export type ArtAiAgentErrorType =
  | "feature_disabled"
  | "provider_not_configured"
  | "invalid_ai_response"
  | "provider_request_failed";

let lastErrorType: ArtAiAgentErrorType | null = null;
let hasSuccessfulProviderCall = false;

export function getArtAiAgentRuntimeStatus() {
  const featureEnabled = ENV.aiArtAgentEnabled;
  const providerConfigured = Boolean(ENV.forgeApiKey);

  return {
    featureEnabled,
    providerConfigured,
    provider: providerConfigured ? "llm" : "fallback",
    mode: featureEnabled && hasSuccessfulProviderCall ? "real" : "preview",
    lastErrorType,
  };
}

function cleanText(value: unknown, fallback = ""): string {
  const text = String(value || "")
    .replace(/\s+/g, " ")
    .trim();
  return text || fallback;
}

function cleanList(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  const items = value
    .map((item) => cleanText(item))
    .filter(Boolean)
    .slice(0, 5);
  return items.length > 0 ? items : fallback;
}

const DEFAULT_ANALYSIS_STEPS = [
  "قراءة بيانات العمل الفني وسياق الطالب.",
  "تحليل الفكرة والعناصر الفنية الأساسية.",
  "ربط العمل بمهارات التكوين واللون والتعبير.",
  "تحديد مستوى الأداء ثم توليد تغذية راجعة ونشاط مناسب.",
];

function buildAnalysisSteps(input: AnalyzeStudentArtworkInput): string[] {
  if (cleanText(input.description).length > 0) {
    return DEFAULT_ANALYSIS_STEPS;
  }

  return [
    "قراءة بيانات العمل الفني وسياق الطالب.",
    "أنشأ الوكيل وصفًا أوليًا اعتمادًا على العنوان والبيانات المتاحة.",
    "تحليل الفكرة والعناصر الفنية الأساسية.",
    "ربط العمل بمهارات التكوين واللون والتعبير.",
    "تحديد مستوى الأداء ثم توليد تغذية راجعة ونشاط مناسب.",
  ];
}

function normalizePerformanceLevel(value: unknown): ArtPerformanceLevel {
  const text = cleanText(value);
  if (text === "يحتاج دعمًا" || text === "في طور التحسن" || text === "متمكن" || text === "متقدم") {
    return text;
  }
  return "متمكن";
}

function normalizeCompletionStatus(value: unknown): ArtCompletionStatus {
  const text = cleanText(value);
  if (text === "مكتمل" || text === "شبه مكتمل" || text === "غير مكتمل") {
    return text;
  }
  return "مكتمل";
}

function normalizeQualityLevel(value: unknown): ArtQualityLevel {
  const text = cleanText(value);
  if (text === "ممتاز" || text === "جيد جدًا" || text === "جيد" || text === "يحتاج دعم") {
    return text;
  }
  return "جيد";
}

function containsAny(text: string, words: string[]): boolean {
  return words.some((word) => text.includes(word));
}

export function applyAssessmentGuardrails(result: StudentArtworkAnalysisResult): StudentArtworkAnalysisResult {
  const combinedText = [
    result.summary,
    ...result.strengths,
    ...result.improvements,
    result.readyFeedback,
    result.studentMessage,
    result.teacherNotes,
    ...(result.analysisSteps || []),
  ].join(" ");
  const positiveCompletionSignals = containsAny(combinedText, [
    "واضح",
    "واضحة",
    "مكتمل",
    "مكتملة",
    "غني بالألوان",
    "غنية بالألوان",
    "تنوع جميل في الألوان",
    "تكوين جيد",
    "تكوينًا جيدًا",
    "توزيع جيد",
    "عناصر متعددة",
    "مساحة الورقة",
    "الورقة ممتلئة",
  ]);
  const incompleteSignals = containsAny(combinedText, [
    "غير مكتمل",
    "غير مكتملة",
    "مساحات كبيرة فارغة",
    "عناصر قليلة جدًا",
    "غياب الفكرة",
    "ضعف واضح في تنفيذ المطلوب",
  ]);
  const lowPerformance = result.performanceLevel === "في طور التحسن" || result.performanceLevel === "يحتاج دعمًا";

  if (!lowPerformance || !positiveCompletionSignals || incompleteSignals) {
    return result;
  }

  return {
    ...result,
    completionStatus: result.completionStatus === "غير مكتمل" ? "مكتمل" : result.completionStatus,
    artisticQualityLevel: result.artisticQualityLevel === "يحتاج دعم" ? "جيد جدًا" : result.artisticQualityLevel,
    performanceLevel: "متمكن",
    teacherNotes: `${result.teacherNotes} تم ضبط مستوى الأداء تلقائيًا لأن وصف التحليل يشير إلى أن العمل واضح أو مكتمل، وملاحظات التحسين لا تعني خفض التصنيف.`,
  };
}

function parseJsonObject(text: string): any | null {
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function buildFallbackAnalysis(input: AnalyzeStudentArtworkInput): StudentArtworkAnalysisResult {
  const title = cleanText(input.title, "العمل الفني");
  const description = cleanText(input.description);
  const studentName = cleanText(input.studentName, "الطالب");
  const classContext = [cleanText(input.gradeName), cleanText(input.className)].filter(Boolean).join(" - ");

  return {
    summary: `يعرض العمل "${title}" فكرة واضحة ومنظمة، ويظهر اهتمامًا بتوزيع العناصر واستخدام اللون داخل مساحة العمل. يمكن تطويره أكثر عبر تحسين دقة بعض الحواف وزيادة العناية بتناسق المساحات.${description ? ` ${description}` : ""}`,
    strengths: [
      "الفكرة العامة للعمل واضحة ومقروءة بصريًا.",
      "توجد عناية بتوزيع العناصر واستخدام الألوان داخل مساحة الورقة.",
      "العمل يعكس قدرة جيدة على التعبير البصري وفق هدف النشاط.",
    ],
    improvements: [
      "تحسين دقة التلوين عند الحواف.",
      "زيادة العناية بتناسق بعض المساحات اللونية.",
      "تجريب تدرجات أو خامات إضافية لإثراء العمل دون تغيير فكرته الأساسية.",
    ],
    completionStatus: "مكتمل",
    artisticQualityLevel: "جيد جدًا",
    performanceLevel: "متمكن",
    readyFeedback: `العمل مكتمل وواضح يا ${studentName}، ويظهر فيه تنوع جميل في الألوان وتوزيع جيد للعناصر. يمكن تطويره أكثر من خلال تحسين دقة التلوين عند الحواف وزيادة العناية بتناسق بعض المساحات.`,
    suggestedActivity: "نشاط إثرائي مقترح: اطلب من الطالب اختيار جزء من العمل وإعادة تنفيذه في بطاقة صغيرة مع تحسين الحواف وتجريب تدرج لوني واحد، ثم مقارنة النسختين لتحديد التطور.",
    studentMessage: `يا ${studentName}، عملك واضح ومكتمل، واستمرارك في تحسين التفاصيل سيجعله أكثر قوة وجمالًا.`,
    teacherNotes: `راجع التغذية الراجعة قبل اعتمادها، ويمكن ربط النشاط المقترح بهدف الدرس ومستوى الطالب${classContext ? ` وسياقه: ${classContext}` : ""}.`,
  };
}

function buildPrompt(input: AnalyzeStudentArtworkInput): string {
  const lines = [
    "اعمل كوكيل تعليمي يشرح خطواته بإيجاز قبل النتيجة.",
    "اتبع هذا التسلسل: قراءة بيانات العمل، تحليل الفكرة والعناصر، ربطها بالمهارات، تحديد مستوى الأداء، توليد التغذية الراجعة، اقتراح نشاط مناسب.",
    "أعد analysisSteps كقائمة من 4 إلى 6 خطوات قصيرة بالعربية.",
    "إذا لم يتوفر وصف للعمل، اذكر ضمن analysisSteps أنك أنشأت أو اعتمدت وصفًا أوليًا من البيانات المتاحة، ولا توقف التحليل.",
    "",
    "حلل عمل طالب في مادة التربية الفنية واكتب تغذية راجعة تربوية عربية منظمة.",
    "",
    "بيانات العمل:",
    `- معرف العمل: ${input.artworkId}`,
    `- العنوان: ${cleanText(input.title, "بدون عنوان")}`,
    `- الوصف: ${cleanText(input.description, "غير متوفر")}`,
    `- اسم الطالب: ${cleanText(input.studentName, "غير متوفر")}`,
    `- الصف: ${cleanText(input.gradeName, "غير متوفر")}`,
    `- الفصل: ${cleanText(input.className, "غير متوفر")}`,
    `- ملاحظات المعلم: ${cleanText(input.teacherNotes, "لا توجد")}`,
    "",
    "التوجيهات:",
    "- لا تستخدم أحكامًا قاسية أو مقارنة بين الطلاب.",
    "- اجعل اللغة تربوية، محددة، ومناسبة لمعلم التربية الفنية.",
    "- ركز على الورقة والعمل الفني فقط، وتجاهل اليدين أو الطالب أو الخلفية أو جودة التصوير ما لم تمنع رؤية العمل فعليًا.",
    "- لا تخفض تقييم الطالب بسبب ظهور اليدين أو الخلفية أو زاوية التصوير. إذا كانت الصورة تحتوي عناصر خارج العمل، أضف reviewAlert مختصرًا للمعلم بدل خفض التقييم.",
    "- افصل بين اكتمال العمل الفني وبين جودة التصوير وبين وجود ملاحظات تحسين بسيطة.",
    "- لا تصنف العمل كـ \"في طور التحسن\" إذا كان الموضوع واضحًا، وأغلب مساحة الورقة منفذة أو ملونة، والتكوين مكتمل، وتوجد عناصر متعددة أو توزيع لوني واضح.",
    "- في حالة العمل المكتمل مع ملاحظات تطوير بسيطة، اجعل completionStatus = \"مكتمل\"، واجعل artisticQualityLevel مثل \"جيد\" أو \"جيد جدًا\"، واجعل performanceLevel غالبًا \"متمكن\" أو \"متقدم\" حسب الجودة.",
    "- اجعل \"في طور التحسن\" مخصصًا فقط للأعمال غير المكتملة فعلًا: مساحات كبيرة فارغة، عناصر قليلة جدًا، ضعف واضح في تنفيذ المطلوب، أو غياب الفكرة.",
    "- إذا لم تكن الصورة متاحة أو غير واضحة، اعتمد على البيانات النصية واذكر ذلك في ملاحظات المعلم أو reviewAlert دون خفض التقييم تلقائيًا.",
    "- إذا لم توجد ملاحظة مراجعة خاصة بالصورة، اجعل reviewAlert نصًا فارغًا.",
    "- استخدم completionStatus واحدًا فقط من هذه القيم: مكتمل، شبه مكتمل، غير مكتمل.",
    "- استخدم artisticQualityLevel واحدًا فقط من هذه القيم: ممتاز، جيد جدًا، جيد، يحتاج دعم.",
    "- استخدم مستوى أداء واحدًا فقط من هذه القيم: يحتاج دعمًا، في طور التحسن، متمكن، متقدم.",
    "- أعد JSON فقط مطابقًا للمخطط.",
  ];

  return lines.join("\n");
}

function normalizeResult(parsed: any, fallback: StudentArtworkAnalysisResult): StudentArtworkAnalysisResult {
  const normalized: StudentArtworkAnalysisResult = {
    analysisSteps: cleanList(parsed?.analysisSteps, fallback.analysisSteps || DEFAULT_ANALYSIS_STEPS),
    summary: cleanText(parsed?.summary, fallback.summary),
    strengths: cleanList(parsed?.strengths, fallback.strengths),
    improvements: cleanList(parsed?.improvements, fallback.improvements),
    completionStatus: normalizeCompletionStatus(parsed?.completionStatus ?? fallback.completionStatus),
    artisticQualityLevel: normalizeQualityLevel(parsed?.artisticQualityLevel ?? fallback.artisticQualityLevel),
    performanceLevel: normalizePerformanceLevel(parsed?.performanceLevel),
    reviewAlert: cleanText(parsed?.reviewAlert),
    readyFeedback: cleanText(parsed?.readyFeedback, fallback.readyFeedback),
    suggestedActivity: cleanText(parsed?.suggestedActivity, fallback.suggestedActivity),
    studentMessage: cleanText(parsed?.studentMessage, fallback.studentMessage),
    teacherNotes: cleanText(parsed?.teacherNotes, fallback.teacherNotes),
  };

  return applyAssessmentGuardrails(normalized);
}

export async function analyzeStudentArtwork(
  input: AnalyzeStudentArtworkInput,
): Promise<StudentArtworkAnalysisResponse> {
  const fallback = buildFallbackAnalysis(input);
  fallback.analysisSteps = buildAnalysisSteps(input);

  if (!ENV.aiArtAgentEnabled || !ENV.forgeApiKey) {
    lastErrorType = ENV.aiArtAgentEnabled ? "provider_not_configured" : "feature_disabled";

    return {
      result: fallback,
      provider: "fallback",
      mode: "preview",
      promptVersion: "art-agent-v2",
      model: ENV.aiArtAgentEnabled ? "fallback-no-ai-key" : "fallback-feature-disabled",
      isFallback: true,
      lastErrorType,
    };
  }

  const hasImage = typeof input.imageUrl === "string" && /^https?:\/\//i.test(input.imageUrl);

  try {
    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content:
            "أنت وكيل ذكي لمعلم التربية الفنية. مهمتك تحليل أعمال الطلاب فنيًا وتربويًا بلغة عربية واضحة ومشجعة، مع نتائج منظمة قابلة للاستخدام داخل منصة تعليمية.",
        },
        {
          role: "user",
          content: hasImage
            ? [
                { type: "text", text: buildPrompt(input) },
                { type: "image_url", image_url: { url: input.imageUrl!, detail: "low" } },
              ]
            : [{ type: "text", text: buildPrompt(input) }],
        },
      ],
      outputSchema: {
        name: "student_artwork_analysis",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            analysisSteps: { type: "array", items: { type: "string" } },
            summary: { type: "string" },
            strengths: { type: "array", items: { type: "string" } },
            improvements: { type: "array", items: { type: "string" } },
            completionStatus: { type: "string", enum: ["مكتمل", "شبه مكتمل", "غير مكتمل"] },
            artisticQualityLevel: { type: "string", enum: ["ممتاز", "جيد جدًا", "جيد", "يحتاج دعم"] },
            performanceLevel: { type: "string", enum: ["يحتاج دعمًا", "في طور التحسن", "متمكن", "متقدم"] },
            reviewAlert: { type: "string" },
            readyFeedback: { type: "string" },
            suggestedActivity: { type: "string" },
            studentMessage: { type: "string" },
            teacherNotes: { type: "string" },
          },
          required: [
            "analysisSteps",
            "summary",
            "strengths",
            "improvements",
            "completionStatus",
            "artisticQualityLevel",
            "performanceLevel",
            "reviewAlert",
            "readyFeedback",
            "suggestedActivity",
            "studentMessage",
            "teacherNotes",
          ],
        },
      },
    });

    const content = response.choices?.[0]?.message?.content;
    const text = Array.isArray(content)
      ? content.map((part: any) => (part?.type === "text" ? String(part.text || "") : "")).join("\n")
      : String(content || "");
    const parsed = parseJsonObject(text);

    if (!parsed) {
      lastErrorType = "invalid_ai_response";

      return {
        result: fallback,
        provider: "fallback",
        mode: "preview",
        promptVersion: "art-agent-v2",
        model: "fallback-invalid-ai-response",
        isFallback: true,
        lastErrorType,
      };
    }

    lastErrorType = null;
    hasSuccessfulProviderCall = true;

    return {
      result: normalizeResult(parsed, fallback),
      provider: "llm",
      mode: "real",
      promptVersion: "art-agent-v2",
      model: cleanText(response.model, "llm"),
      isFallback: false,
    };
  } catch {
    lastErrorType = "provider_request_failed";

    return {
      result: fallback,
      provider: "fallback",
      mode: "preview",
      promptVersion: "art-agent-v2",
      model: "fallback-ai-error",
      isFallback: true,
      lastErrorType,
    };
  }
}
