import { useAuth } from "@/_core/hooks/useAuth";
import PageBackButton from "@/components/PageBackButton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { APP_LOGO } from "@/const";
import { trpc } from "@/lib/trpc";
import { AlertTriangle, Bot, ClipboardCopy, ExternalLink, Loader2, Printer, Save, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

type AnalysisResult = {
  analysisSteps?: string[];
  summary: string;
  strengths: string[];
  improvements: string[];
  completionStatus: "مكتمل" | "شبه مكتمل" | "غير مكتمل";
  artisticQualityLevel: "ممتاز" | "جيد جدًا" | "جيد" | "يحتاج دعم";
  performanceLevel: "يحتاج دعمًا" | "في طور التحسن" | "متمكن" | "متقدم";
  reviewAlert?: string;
  readyFeedback: string;
  suggestedActivity: string;
  studentMessage: string;
  teacherNotes: string;
};

const DEMO_PRESENTATION_SUMMARY =
  "يساعد وكيل معلم التربية الفنية لتحليل أعمال الطلاب المعلم على تحليل أعمال الطلاب وكتابة تغذية راجعة مخصصة واقتراح أنشطة علاجية أو إثرائية خلال ثوانٍ.";
const COPILOT_AGENT_URL =
  "https://m365.cloud.microsoft/chat/?titleId=T_40a80c99-7f9e-5c95-5bf4-6f4068fc23b0&source=embedded-builder";

const DEMO_ANALYSIS_RESULT: AnalysisResult = {
  analysisSteps: [
    "قرأ الوكيل عنوان العمل ووصفه وسياق الطالب.",
    "حلل الفكرة الفنية واستخدام اللون والتكوين.",
    "ربط العمل بمهارات التعبير البصري وتنظيم العناصر.",
    "حدد مستوى الأداء وصاغ تغذية راجعة ونشاطًا مناسبًا.",
  ],
  summary:
    "يعرض العمل الفني بعنوان: بيت في الحي محاولة جيدة للتعبير عن المكان باستخدام أشكال بسيطة وألوان هادئة، مع حاجة إلى تنظيم العناصر وإضافة تفاصيل تساعد على إبراز الفكرة.",
  strengths: [
    "الفكرة واضحة وقريبة من خبرة الطالب اليومية.",
    "استخدام الألوان يمنح العمل طابعًا هادئًا ومناسبًا للموضوع.",
    "توزيع العناصر الأساسية يساعد على فهم المشهد بسرعة.",
  ],
  improvements: [
    "إضافة تفاصيل للواجهة والنوافذ لجعل البيت أكثر حيوية.",
    "تحسين العلاقة بين أحجام العناصر داخل مساحة الورقة.",
    "تجربة تدرجات لونية في السماء والأرض لإثراء المشهد.",
  ],
  completionStatus: "مكتمل",
  artisticQualityLevel: "جيد جدًا",
  performanceLevel: "متمكن",
  readyFeedback:
    "العمل مكتمل وواضح، ويظهر فيه تنوع جميل في الألوان وتوزيع جيد للعناصر. يمكن تطويره أكثر من خلال تحسين دقة التلوين عند الحواف وزيادة العناية بتناسق بعض المساحات.",
  suggestedActivity:
    "نشاط مقترح: اطلب من الطالب رسم نسخة مصغرة من العمل بثلاث إضافات جديدة: تفصيل معماري، تدرج لوني، وعنصر يوضح الحياة داخل الحي.",
  studentMessage: "استمر في تطوير فكرتك، لديك بداية جيدة ومع التفاصيل سيصبح العمل أكثر تعبيرًا.",
  teacherNotes: "هذا المثال مخصص للعرض التجريبي في حال عدم توفر أعمال فعلية داخل الفصل.",
};

const AGENT_WORKFLOW_STEPS = [
  "يقرأ بيانات العمل الفني",
  "يحلل العناصر والمهارات",
  "يحدد مستوى الأداء",
  "يقترح تغذية راجعة ونشاطًا مناسبًا",
];

function ResultCard({
  title,
  children,
  className = "",
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={`border-slate-200 shadow-sm ${className}`}>
      <CardHeader className="pb-3">
        <CardTitle className="text-base text-slate-900">{title}</CardTitle>
      </CardHeader>
      <CardContent className="text-sm leading-7 text-slate-700">{children}</CardContent>
    </Card>
  );
}

async function copyText(text: string, label: string) {
  await navigator.clipboard.writeText(text);
  toast.success(`تم نسخ ${label}`);
}

type CertificateSettingsForReport = {
  profile?: any;
  template?: any;
};

function escapeHtml(value: unknown): string {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function cleanReportText(value: unknown): string {
  return String(value || "")
    .replace(/هذا تحليل توضيحي يساعدك على تجربة طريقة عمل الوكيل\.?/g, "")
    .replace(/عند تفعيل مزود الذكاء الاصطناعي[^.]*\.?/g, "")
    .replace(/إعدادات الخادم/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function renderList(items: string[]) {
  return `<ul>${items.map((item) => `<li>${escapeHtml(cleanReportText(item))}</li>`).join("")}</ul>`;
}

function renderHeaderLogo(url: string | null | undefined) {
  const text = String(url || "").trim();
  return `
    <div class="brand-mark">
      ${text ? `<img class="brand-logo" src="${escapeHtml(text)}" alt="" />` : `<div class="brand-placeholder" aria-hidden="true"></div>`}
    </div>
  `;
}

function renderDataRow(icon: string, label: string, value: unknown) {
  const text = cleanReportText(value);
  return `
    <tr>
      <td class="data-icon">${escapeHtml(icon)}</td>
      <th>${escapeHtml(label)}</th>
      <td>${text ? escapeHtml(text) : "-"}</td>
    </tr>
  `;
}

function renderArtworkImage(imageUrl: string) {
  if (!imageUrl) {
    return `<div class="artwork-fallback">لم تُرفق صورة لهذا العمل</div>`;
  }

  return `<img class="artwork-image" src="${escapeHtml(imageUrl)}" alt="صورة العمل الفني" />`;
}

function renderAnalysisCard(index: number, title: string, content: string | string[], color: string, icon: string) {
  const body = Array.isArray(content)
    ? renderList(content.filter((item) => cleanReportText(item)))
    : `<p>${escapeHtml(cleanReportText(content)) || "-"}</p>`;

  return `
    <section class="analysis-card ${escapeHtml(color)}">
      <div class="card-heading">
        <span class="card-icon">${escapeHtml(icon)}</span>
        <h2>${index}. ${escapeHtml(title)}</h2>
      </div>
      <div class="card-body">${body}</div>
    </section>
  `;
}

function renderSignature(name: string, signatureUrl: string | null | undefined, label: string) {
  const cleanedName = cleanReportText(name);
  const url = String(signatureUrl || "").trim();
  return `
    <div class="signature-slot">
      <div class="signature-area">
        ${url ? `<img class="signature-image" src="${escapeHtml(url)}" alt="${escapeHtml(label)}" />` : `<div class="signature-line"></div>`}
      </div>
      <div class="signature-name">${escapeHtml(label)}: ${cleanedName ? escapeHtml(cleanedName) : "................................"}</div>
    </div>
  `;
}

function buildFullReport(result: AnalysisResult) {
  return [
    "تقرير وكيل معلم التربية الفنية لتحليل أعمال الطلاب",
    "",
    `ملخص التحليل: ${cleanReportText(result.summary)}`,
    "",
    `حالة اكتمال العمل: ${result.completionStatus}`,
    `مستوى الجودة الفنية: ${result.artisticQualityLevel}`,
    `مستوى الأداء: ${result.performanceLevel}`,
    result.reviewAlert ? `تنبيه مراجعة: ${cleanReportText(result.reviewAlert)}` : "",
    "",
    "نقاط القوة:",
    ...result.strengths.map((item) => `- ${cleanReportText(item)}`),
    "",
    "جوانب التحسين:",
    ...result.improvements.map((item) => `- ${cleanReportText(item)}`),
    "",
    `التغذية الراجعة للطالب: ${cleanReportText(result.readyFeedback)}`,
    "",
    `النشاط المقترح: ${cleanReportText(result.suggestedActivity)}`,
    "",
    `رسالة الطالب: ${cleanReportText(result.studentMessage)}`,
    "",
    `ملاحظات للمعلم: ${cleanReportText(result.teacherNotes)}`,
    ...(result.analysisSteps?.length
      ? [
          "",
          "خطوات التحليل:",
          ...result.analysisSteps.map((item) => `- ${cleanReportText(item)}`),
        ]
      : []),
  ].join("\n");
}

function buildPrintableReportHtml(input: {
  result: AnalysisResult;
  artwork?: any;
  settings?: CertificateSettingsForReport | null;
  user?: any;
}) {
  const { result, artwork, settings, user } = input;
  const profile = settings?.profile || {};
  const template = settings?.template || {};
  const reportDate = new Intl.DateTimeFormat("ar-SA", { dateStyle: "medium" }).format(new Date());
  const schoolName = cleanReportText(profile.schoolName || template.issuerName || "");
  const educationDepartment = cleanReportText(profile.educationDepartment || profile.educationOffice || "");
  const teacherName = cleanReportText(profile.teacherDisplayName || profile.teacherName || user?.name || "");
  const principalName = cleanReportText(profile.principalDisplayName || "");
  const teacherSignature = String(profile.teacherSignature || "").trim();
  const principalSignature = String(profile.principalSignature || "").trim();
  const showMinistryLogo = template.showMinistryLogo !== false;
  const showSchoolLogo = template.showSchoolLogo !== false;
  const showTeacherSignature = template.showTeacherSignature !== false;
  const showPrincipalSignature = template.showPrincipalSignature !== false;
  const artworkImage = String(artwork?.imageUrl || "").trim();
  const reportTitle = "تقرير تحليل العمل الفني";
  const schoolLabel = schoolName || "اسم المدرسة";
  const studentName = artwork?.studentName || "";
  const className = artwork?.className || "";
  const gradeName = artwork?.gradeName || "";
  const artworkTitle = artwork?.title || "";

  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8" />
  <title>${reportTitle}</title>
  <style>
    @page { size: A4; margin: 0; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #eef4f7; color: #08233f; direction: rtl; }
    body { font-family: "Harir", "Tahoma", "Arial", sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .page {
      position: relative;
      width: 210mm;
      min-height: 297mm;
      margin: 0 auto 8mm;
      padding: 10mm 11mm 14mm;
      background: #fff;
      border: 1.4pt solid #0b355f;
      border-radius: 2.5mm;
      overflow: hidden;
      page-break-after: always;
    }
    .page:last-child { page-break-after: auto; }
    .page::before {
      content: "";
      position: absolute;
      inset: 4mm;
      border: 0.4pt solid rgba(15, 118, 110, 0.18);
      pointer-events: none;
    }
    .report-header {
      display: grid;
      grid-template-columns: 36mm 1fr 36mm;
      align-items: start;
      gap: 7mm;
      margin-bottom: 7mm;
      direction: ltr;
    }
    .brand-mark { min-height: 23mm; display: flex; align-items: flex-start; justify-content: center; }
    .brand-logo { max-width: 30mm; max-height: 18mm; object-fit: contain; display: block; margin: 0 auto 1.5mm; }
    .brand-placeholder { width: 30mm; height: 18mm; border-radius: 2mm; border: 0.7pt dashed rgba(15, 118, 110, 0.22); }
    .school-brand { grid-column: 1; }
    .report-title-cell { grid-column: 2; direction: rtl; }
    .ministry-brand { grid-column: 3; }
    .title-block { text-align: center; padding-top: 8mm; }
    .title-block h1 { margin: 0; color: #082f5f; font-size: 22pt; font-weight: 900; line-height: 1.25; }
    .title-rule { width: 58mm; height: 0.6mm; margin: 4mm auto 2.5mm; background: linear-gradient(90deg, transparent, #0f766e, transparent); position: relative; }
    .title-rule::after { content: ""; width: 2.2mm; height: 2.2mm; border-radius: 50%; background: #0f766e; position: absolute; top: -0.8mm; right: calc(50% - 1.1mm); }
    .school-name { margin: 0; color: #0f385e; font-size: 12pt; font-weight: 700; }
    .section-heading {
      display: flex;
      justify-content: center;
      align-items: center;
      gap: 3mm;
      color: #075d62;
      font-size: 14pt;
      font-weight: 900;
      margin: 3mm 0 3.5mm;
    }
    .section-heading .heading-icon { font-size: 16pt; }
    .data-table {
      width: 100%;
      border-collapse: separate;
      border-spacing: 0;
      border: 1.2pt solid #0f766e;
      border-radius: 3mm;
      overflow: hidden;
      table-layout: fixed;
      margin-bottom: 4mm;
      direction: rtl;
    }
    .data-table tr { height: 11mm; }
    .data-table th, .data-table td {
      border-bottom: 0.7pt solid rgba(15, 118, 110, 0.45);
      border-left: 0.7pt solid rgba(15, 118, 110, 0.45);
      padding: 2mm 3mm;
      vertical-align: middle;
      text-align: center;
      font-size: 10.5pt;
      line-height: 1.45;
      overflow-wrap: anywhere;
    }
    .data-table tr:last-child th, .data-table tr:last-child td { border-bottom: 0; }
    .data-table th { width: 42mm; color: #063f58; background: #f4fbfb; font-weight: 900; }
    .data-table td { color: #0f172a; background: #fff; font-weight: 600; }
    .data-table .data-icon { width: 13mm; color: #0f766e; font-size: 15pt; background: #f8ffff; border-left: 0.7pt solid rgba(15, 118, 110, 0.45); }
    .image-title { margin-top: 3mm; }
    .artwork-frame {
      width: 100%;
      min-height: 116mm;
      max-height: 130mm;
      padding: 3mm;
      border: 1.3pt solid #0f766e;
      border-radius: 3.2mm;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      background: #fff;
    }
    .artwork-image {
      display: block;
      max-width: 100%;
      max-height: 123mm;
      width: auto;
      height: auto;
      object-fit: contain;
      border-radius: 1.8mm;
    }
    .artwork-fallback {
      width: 100%;
      min-height: 104mm;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 1pt dashed #88a9a8;
      border-radius: 2mm;
      color: #5b6778;
      font-size: 15pt;
      font-weight: 800;
      background: #f8fbfc;
    }
    .analysis-top {
      display: grid;
      grid-template-columns: 1fr auto 1fr;
      align-items: center;
      gap: 5mm;
      margin: 0 0 6mm;
    }
    .analysis-top h1 { margin: 0; color: #082f5f; font-size: 18pt; font-weight: 900; text-align: center; white-space: nowrap; }
    .analysis-line { height: 0.4mm; background: linear-gradient(90deg, transparent, #0f766e); position: relative; }
    .analysis-line.left { background: linear-gradient(90deg, #0f766e, transparent); }
    .analysis-line::after { content: ""; position: absolute; top: -0.8mm; width: 2mm; height: 2mm; border-radius: 50%; background: #0f766e; }
    .analysis-line.right::after { left: 0; }
    .analysis-line.left::after { right: 0; }
    .analysis-card {
      border: 1pt solid var(--card-color);
      border-radius: 2.5mm;
      padding: 2.8mm 3.5mm;
      margin-bottom: 3mm;
      background: linear-gradient(90deg, var(--card-bg), #fff 58%);
      break-inside: avoid;
    }
    .analysis-card.blue { --card-color: #2f80d1; --card-bg: #f3f9ff; }
    .analysis-card.green { --card-color: #2f8a3b; --card-bg: #f7fff8; }
    .analysis-card.orange { --card-color: #f97316; --card-bg: #fff9f1; }
    .analysis-card.purple { --card-color: #7c3fb2; --card-bg: #fbf7ff; }
    .analysis-card.cyan { --card-color: #12848d; --card-bg: #f3fdff; }
    .card-heading { display: flex; align-items: center; justify-content: flex-start; gap: 2mm; color: var(--card-color); }
    .card-heading h2 { margin: 0; font-size: 11.5pt; font-weight: 900; }
    .card-icon { font-size: 15pt; line-height: 1; }
    .card-body { color: #0f172a; font-size: 10pt; line-height: 1.55; text-align: center; padding: 1mm 5mm 0; }
    .card-body p { margin: 0; }
    .card-body ul { margin: 0; padding: 0 6mm 0 0; text-align: right; display: inline-block; }
    .card-body li { margin: 0.4mm 0; }
    .signature-panel {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 14mm;
      border: 0.8pt dashed #b7c6cf;
      border-radius: 2mm;
      padding: 3.5mm 8mm;
      margin-top: 2mm;
      color: #08233f;
      break-inside: avoid;
    }
    .signature-slot { text-align: center; font-size: 9.5pt; font-weight: 700; }
    .signature-area { height: 19mm; display: flex; align-items: end; justify-content: center; margin-bottom: 2mm; }
    .signature-image { max-width: 45mm; max-height: 18mm; object-fit: contain; display: block; }
    .signature-line { width: 48mm; border-bottom: 0.9pt solid #334155; height: 14mm; }
    .signature-name { border-bottom: 0.8pt dotted #334155; padding-bottom: 1mm; min-height: 6mm; }
    .page-number-row {
      position: absolute;
      right: 11mm;
      left: 11mm;
      bottom: 7mm;
      display: grid;
      grid-template-columns: 1fr auto 1fr;
      align-items: center;
      gap: 5mm;
    }
    .page-number-row::before, .page-number-row::after { content: ""; height: 0.35mm; background: linear-gradient(90deg, transparent, #0f766e, transparent); }
    .page-number {
      width: 9mm;
      height: 9mm;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 50%;
      color: #fff;
      background: #0f766e;
      font-size: 12pt;
      font-weight: 900;
      box-shadow: 0 1mm 3mm rgba(15, 118, 110, 0.28);
    }
    @media print {
      body { background: #fff; }
      .page { margin: 0; border-radius: 0; }
    }
  </style>
</head>
<body>
  <article class="page">
    <header class="report-header">
      <div class="school-brand">${showSchoolLogo ? renderHeaderLogo(template.schoolLogoUrl) : ""}</div>
      <div class="title-block report-title-cell">
        <h1>${reportTitle}</h1>
        <div class="title-rule"></div>
        <p class="school-name">${escapeHtml(schoolLabel)}</p>
        ${educationDepartment ? `<p class="school-name" style="font-size: 9.5pt; margin-top: 1mm; color: #486173;">${escapeHtml(educationDepartment)}</p>` : ""}
      </div>
      <div class="ministry-brand">${showMinistryLogo ? renderHeaderLogo(template.ministryLogoUrl) : ""}</div>
    </header>

    <section>
      <div class="section-heading"><span>بيانات العمل الفني</span><span class="heading-icon">📋</span></div>
      <table class="data-table" aria-label="بيانات العمل الفني">
        <tbody>
          ${renderDataRow("👤", "اسم الطالب", studentName)}
          ${renderDataRow("👥", "الصف/المرحلة", gradeName)}
          ${renderDataRow("📘", "الفصل", className)}
          ${renderDataRow("🎨", "اسم العمل الفني", artworkTitle)}
          ${renderDataRow("📅", "تاريخ التقرير", reportDate)}
          ${renderDataRow("★", "مستوى الأداء", result.performanceLevel)}
        </tbody>
      </table>
    </section>

    <section>
      <div class="section-heading image-title"><span>صورة العمل الفني</span><span class="heading-icon">🖼</span></div>
      <div class="artwork-frame">
        ${renderArtworkImage(artworkImage)}
      </div>
    </section>

    <div class="page-number-row"><span class="page-number">1</span></div>
  </article>

  <article class="page">
    <header class="analysis-top">
      <div class="analysis-line right"></div>
      <h1>نتيجة التحليل 📋</h1>
      <div class="analysis-line left"></div>
    </header>

    ${renderAnalysisCard(1, "ملخص العمل الفني", result.summary, "blue", "📝")}
    ${renderAnalysisCard(2, "نقاط القوة", result.strengths, "green", "💪")}
    ${renderAnalysisCard(3, "جوانب التحسين", result.improvements, "orange", "📈")}
    ${renderAnalysisCard(4, "مستوى الأداء", `${result.performanceLevel} - ${result.artisticQualityLevel} - ${result.completionStatus}`, "purple", "🏅")}
    ${renderAnalysisCard(5, "تغذية راجعة للطالب", result.readyFeedback || result.studentMessage, "blue", "💬")}
    ${renderAnalysisCard(6, "نشاط مقترح", result.suggestedActivity, "cyan", "💡")}
    ${renderAnalysisCard(7, "ملاحظات للمعلم", result.teacherNotes || result.reviewAlert || "", "orange", "👤")}

    <section class="signature-panel">
      ${renderSignature(teacherName, showTeacherSignature ? teacherSignature : null, "اسم المعلم")}
      ${renderSignature(principalName, showPrincipalSignature ? principalSignature : null, "اسم مدير المدرسة")}
    </section>

    <div class="page-number-row"><span class="page-number">2</span></div>
  </article>
</body>
</html>`;
}

export default function TeacherAiArtAgent() {
  const { user, loading } = useAuth();
  const [selectedArtworkId, setSelectedArtworkId] = useState("");
  const [requestedArtworkApplied, setRequestedArtworkApplied] = useState(false);
  const [teacherNotes, setTeacherNotes] = useState("");
  const [demoResult, setDemoResult] = useState<AnalysisResult | null>(null);
  const [editedResult, setEditedResult] = useState<AnalysisResult | null>(null);
  const requestedArtworkId = useMemo(() => new URLSearchParams(window.location.search).get("artworkId") || "", []);

  const statusQuery = trpc.teacher.aiArtAgent.getStatus.useQuery(undefined, {
    enabled: !!user && (user.role === "teacher" || user.role === "admin"),
  });
  const artworksQuery = trpc.teacher.aiArtAgent.getArtworkOptions.useQuery(undefined, {
    enabled: !!user && (user.role === "teacher" || user.role === "admin"),
  });
  const recentAnalysesQuery = trpc.teacher.aiArtAgent.getRecentAnalyses.useQuery(undefined, {
    enabled: !!user && (user.role === "teacher" || user.role === "admin"),
  });
  const certificateSettingsQuery = trpc.certificates.getTeacherSettings.useQuery(undefined, {
    enabled: !!user && (user.role === "teacher" || user.role === "admin"),
  });
  const analyzeMutation = trpc.teacher.aiArtAgent.analyzeArtwork.useMutation({
    onSuccess: (data) => {
      setDemoResult(null);
      setEditedResult(data.result as AnalysisResult);
      toast.success(data.saved ? "تم تحليل العمل وحفظ النتيجة" : "تم تحليل العمل بدون حفظ دائم");
      recentAnalysesQuery.refetch();
    },
    onError: (error) => {
      toast.error(error.message || "تعذر تحليل العمل الفني");
    },
  });
  const updateAnalysisMutation = trpc.teacher.aiArtAgent.updateAnalysisResult.useMutation({
    onSuccess: () => {
      toast.success("تم حفظ تعديل المعلم");
      recentAnalysesQuery.refetch();
    },
    onError: (error) => {
      toast.error(error.message || "تعذر حفظ تعديل المعلم");
    },
  });

  const artworks = artworksQuery.data || [];
  const selectedArtwork = useMemo(
    () => artworks.find((artwork) => String(artwork.id) === selectedArtworkId),
    [artworks, selectedArtworkId],
  );
  const result = editedResult || (analyzeMutation.data?.result as AnalysisResult | undefined) || demoResult || undefined;

  useEffect(() => {
    if (requestedArtworkId && !requestedArtworkApplied && artworks.some((artwork) => String(artwork.id) === requestedArtworkId)) {
      setSelectedArtworkId(requestedArtworkId);
      setRequestedArtworkApplied(true);
      return;
    }

    if (!selectedArtworkId && artworks[0]) {
      setSelectedArtworkId(String(artworks[0].id));
    }
  }, [artworks, requestedArtworkApplied, requestedArtworkId, selectedArtworkId]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  if (!user || (user.role !== "teacher" && user.role !== "admin")) {
    window.location.href = "/";
    return null;
  }

  const isFeatureEnabled = Boolean(statusQuery.data?.featureEnabled ?? statusQuery.data?.enabled);
  const statusMode = statusQuery.data?.mode;
  const isAnalyzing = analyzeMutation.isPending;
  const analysisMode = analyzeMutation.data?.mode || (demoResult ? "preview" : undefined);
  const isRealModeConnected = analysisMode === "real" || statusMode === "real";

  const handleAnalyze = () => {
    const artworkId = Number(selectedArtworkId);
    if (!artworkId) {
      toast.error("اختر عملًا فنيًا أولًا");
      return;
    }

    setEditedResult(null);
    analyzeMutation.mutate({
      artworkId,
      teacherNotes: teacherNotes.trim() || undefined,
    });
  };

  const handleDemo = () => {
    setDemoResult(DEMO_ANALYSIS_RESULT);
    setEditedResult(DEMO_ANALYSIS_RESULT);
    toast.success("تم عرض مثال توضيحي للوكيل الذكي");
  };

  const updateResultField = <K extends keyof AnalysisResult>(field: K, value: AnalysisResult[K]) => {
    if (!result) return;
    setEditedResult({
      ...result,
      [field]: value,
    });
  };

  const handleSaveTeacherAdjustment = () => {
    if (!result) return;

    const analysisId = analyzeMutation.data?.analysisId;
    if (!analysisId) {
      toast.success("تم حفظ تعديل المعلم محليًا في التقرير الحالي");
      return;
    }

    updateAnalysisMutation.mutate({
      analysisId,
      result,
    });
  };

  const getReportArtwork = () => selectedArtwork;

  const buildCurrentReportHtml = () => {
    if (!result) return "";

    return buildPrintableReportHtml({
      result,
      artwork: getReportArtwork(),
      settings: certificateSettingsQuery.data,
      user,
    });
  };

  const handlePrintReport = () => {
    if (!result) return;

    const reportWindow = window.open("", "_blank", "width=960,height=1200");
    if (!reportWindow) {
      toast.error("تعذر فتح نافذة الطباعة. تحقق من إعدادات المتصفح.");
      return;
    }

    const html = buildCurrentReportHtml();
    reportWindow.document.open();
    reportWindow.document.write(html);
    reportWindow.document.close();
    reportWindow.focus();
    reportWindow.setTimeout(() => {
      reportWindow.print();
    }, 350);
  };

  return (
    <div className="min-h-screen bg-slate-50" dir="rtl">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white shadow-sm">
        <div className="container flex h-16 items-center justify-between">
          <div className="flex items-center gap-3">
            <PageBackButton label="رجوع" fallbackPath="/teacher/dashboard" />
            <img src={APP_LOGO} alt="شعار المنصة" className="h-10 w-10 rounded-lg object-cover" />
            <div>
              <h1 className="text-xl font-bold text-slate-950">وكيل معلم التربية الفنية لتحليل أعمال الطلاب</h1>
              <p className="text-xs text-slate-500">تحليل أعمال الطلاب وصياغة تغذية راجعة تربوية</p>
            </div>
          </div>
          <Badge variant={isFeatureEnabled ? "default" : "secondary"}>
            {isFeatureEnabled ? (isRealModeConnected ? "تحليل حقيقي متصل" : "وضع المعاينة") : "غير مفعل"}
          </Badge>
        </div>
      </header>

      <main className="container py-8">
        <section className="mb-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="max-w-3xl">
              <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
                <Bot className="h-6 w-6" />
              </div>
              <h2 className="text-2xl font-bold text-slate-950">تحليل تربوي منظم في دقائق</h2>
              <p className="mt-2 text-sm font-medium text-slate-700">
                يساعدك الوكيل الذكي على تحليل أعمال الطلاب وكتابة تغذية راجعة تربوية قابلة للاستخدام مباشرة.
              </p>
              <p className="mt-2 text-sm leading-7 text-slate-600">
                اختر عملًا فنيًا من أحدث أعمال طلابك، ثم احصل على ملخص، نقاط قوة، جوانب تحسين،
                مستوى أداء، ورسائل جاهزة للطالب والمعلم.
              </p>
              <p className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-6 text-slate-600">
                يمكن للوكيل الاستفادة من وصف العمل عند توفره، أو تحليل العمل بناءً على العنوان والصورة والبيانات المتاحة عند عدم وجود وصف.
              </p>
            </div>
            {!isFeatureEnabled ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                فعّل المتغير AI_ART_AGENT_ENABLED=true لاستخدام الوكيل.
              </div>
            ) : null}
            <Button
              variant="outline"
              className="w-fit border-emerald-200 bg-white text-emerald-800 hover:bg-emerald-50"
              onClick={() => copyText(DEMO_PRESENTATION_SUMMARY, "ملخص العرض")}
            >
              <ClipboardCopy className="ml-2 h-4 w-4" />
              نسخ ملخص العرض
            </Button>
          </div>
        </section>

        <section className="mb-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-emerald-700" />
            <h2 className="text-lg font-bold text-slate-950">كيف يعمل الوكيل؟</h2>
          </div>
          <div className="grid gap-3 md:grid-cols-4">
            {AGENT_WORKFLOW_STEPS.map((step, index) => (
              <div key={step} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-full bg-emerald-700 text-sm font-bold text-white">
                  {index + 1}
                </div>
                <p className="text-sm font-medium leading-6 text-slate-800">{step}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mb-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <Bot className="h-5 w-5 text-emerald-700" />
            <h2 className="text-lg font-bold text-slate-950">استخدم الوكيل بطريقتين</h2>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-4">
              <h3 className="mb-2 text-base font-bold text-emerald-950">داخل منصة التربية الفنية</h3>
              <p className="text-sm leading-7 text-emerald-900">
                حلل أعمال الطلاب مباشرة من بيانات المنصة، وانسخ التغذية الراجعة أو التقرير كاملًا.
              </p>
            </div>
            <div className="rounded-xl border border-sky-100 bg-sky-50 p-4">
              <h3 className="mb-2 text-base font-bold text-sky-950">عبر Microsoft Copilot</h3>
              <p className="mb-4 text-sm leading-7 text-sky-900">
                افتح نسخة Microsoft Copilot Agent لاستخدام الوكيل داخل بيئة Microsoft 365.
              </p>
              <Button className="bg-sky-700 text-white hover:bg-sky-800" asChild>
                <a href={COPILOT_AGENT_URL} target="_blank" rel="noreferrer">
                  <ExternalLink className="ml-2 h-4 w-4" />
                  فتح الوكيل في Microsoft Copilot
                </a>
              </Button>
              <p className="mt-3 text-xs leading-6 text-sky-800">
                قد يتطلب الوصول حساب Microsoft 365 Copilot داخل المؤسسة.
              </p>
              <p className="mt-2 text-xs leading-6 text-sky-800">
                لا يتم إرسال البيانات تلقائيًا إلى Microsoft Copilot؛ يقرر المعلم ما يريد نسخه ومشاركته.
              </p>
            </div>
          </div>
        </section>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,420px)_1fr]">
          <Card className="border-slate-200 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Sparkles className="h-5 w-5 text-emerald-700" />
                اختيار العمل الفني
              </CardTitle>
              <CardDescription>تظهر هنا أحدث الأعمال الفنية المرتبطة بفصولك.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="artwork-select">العمل الفني</Label>
                <Select value={selectedArtworkId} onValueChange={setSelectedArtworkId} disabled={artworksQuery.isLoading}>
                  <SelectTrigger id="artwork-select" className="bg-white">
                    <SelectValue placeholder={artworksQuery.isLoading ? "جار تحميل الأعمال..." : "اختر عملًا فنيًا"} />
                  </SelectTrigger>
                  <SelectContent>
                    {artworks.map((artwork) => (
                      <SelectItem key={artwork.id} value={String(artwork.id)}>
                        {artwork.title} - {artwork.studentName || "طالب"} - {artwork.className}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {selectedArtwork ? (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  {selectedArtwork.imageUrl ? (
                    <img
                      src={selectedArtwork.imageUrl}
                      alt={selectedArtwork.title}
                      className="mb-3 aspect-video w-full rounded-md object-cover"
                    />
                  ) : null}
                  <h3 className="font-semibold text-slate-900">{selectedArtwork.title}</h3>
                  <p className="mt-1 text-sm text-slate-600">
                    {selectedArtwork.studentName || "طالب"} | {selectedArtwork.gradeName || "بدون صف"} |{" "}
                    {selectedArtwork.className || "بدون فصل"}
                  </p>
                  {selectedArtwork.description ? (
                    <p className="mt-2 line-clamp-3 text-sm leading-6 text-slate-600">{selectedArtwork.description}</p>
                  ) : null}
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
                  <Bot className="mx-auto mb-3 h-9 w-9 text-slate-400" />
                  <p className="text-sm font-medium text-slate-700">لا توجد أعمال فنية متاحة للتحليل حاليًا</p>
                  <Button
                    type="button"
                    variant="outline"
                    className="mt-4 border-emerald-200 bg-white text-emerald-800 hover:bg-emerald-50"
                    onClick={handleDemo}
                  >
                    <Sparkles className="ml-2 h-4 w-4" />
                    تجربة مثال توضيحي
                  </Button>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="teacher-notes">ملاحظات المعلم الاختيارية</Label>
                <Textarea
                  id="teacher-notes"
                  value={teacherNotes}
                  onChange={(event) => setTeacherNotes(event.target.value)}
                  placeholder="اكتب سياقًا إضافيًا عن الدرس أو هدف النشاط..."
                  className="min-h-28 bg-white"
                />
              </div>

              <Button
                className="w-full bg-emerald-700 text-white hover:bg-emerald-800"
                disabled={!isFeatureEnabled || !selectedArtwork || isAnalyzing}
                onClick={handleAnalyze}
              >
                {isAnalyzing ? <Loader2 className="ml-2 h-4 w-4 animate-spin" /> : <Sparkles className="ml-2 h-4 w-4" />}
                تحليل العمل الفني
              </Button>
            </CardContent>
          </Card>

          <div className="space-y-6">
            {isAnalyzing ? (
              <Card className="border-slate-200 shadow-sm">
                <CardContent className="flex min-h-64 flex-col items-center justify-center gap-3 text-slate-600">
                  <Loader2 className="h-9 w-9 animate-spin text-emerald-700" />
                  <p className="text-sm">جار تحليل العمل الفني وإعداد التغذية الراجعة...</p>
                </CardContent>
              </Card>
            ) : result ? (
              <>
                {analysisMode === "preview" ? (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-7 text-amber-900">
                    يعمل الوكيل حاليًا في وضع المعاينة.
                  </div>
                ) : null}

                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div>
                    <h2 className="text-lg font-bold text-slate-950">نتيجة التحليل</h2>
                    <p className="text-sm text-slate-500">
                      حالة العمل: <span className="font-semibold text-emerald-700">{result.completionStatus}</span>
                      <span className="mx-2 text-slate-300">|</span>
                      الجودة الفنية: <span className="font-semibold text-emerald-700">{result.artisticQualityLevel}</span>
                      <span className="mx-2 text-slate-300">|</span>
                      مستوى الأداء: <span className="font-semibold text-emerald-700">{result.performanceLevel}</span>
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={handlePrintReport} className="bg-emerald-700 text-white hover:bg-emerald-800">
                      <Printer className="ml-2 h-4 w-4" />
                      طباعة / حفظ PDF
                    </Button>
                    <Button variant="outline" onClick={() => copyText(result.readyFeedback, "التغذية الراجعة فقط")}>
                      <ClipboardCopy className="ml-2 h-4 w-4" />
                      نسخ التغذية الراجعة فقط
                    </Button>
                    <Button variant="outline" onClick={() => copyText(buildFullReport(result), "التقرير كاملًا")}>
                      <ClipboardCopy className="ml-2 h-4 w-4" />
                      نسخ التقرير كاملًا
                    </Button>
                  </div>
                </div>

                {result.reviewAlert ? (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-7 text-amber-900">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="mt-1 h-4 w-4 shrink-0" />
                      <p>{result.reviewAlert}</p>
                    </div>
                  </div>
                ) : null}

                <Card className="border-emerald-100 bg-emerald-50 shadow-sm">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base text-emerald-950">تعديل المعلم للنتيجة</CardTitle>
                    <CardDescription className="text-emerald-900">
                      حكم المعلم هو المرجع النهائي. يمكنك تعديل اكتمال العمل ومستوى الأداء قبل حفظ التقرير أو نسخه.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="grid gap-3 md:grid-cols-[1fr_1fr_1fr_auto] md:items-end">
                    <div className="space-y-2">
                      <Label>حالة اكتمال العمل</Label>
                      <Select
                        value={result.completionStatus}
                        onValueChange={(value) => updateResultField("completionStatus", value as AnalysisResult["completionStatus"])}
                      >
                        <SelectTrigger className="bg-white">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="مكتمل">مكتمل</SelectItem>
                          <SelectItem value="شبه مكتمل">شبه مكتمل</SelectItem>
                          <SelectItem value="غير مكتمل">غير مكتمل</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>مستوى الجودة الفنية</Label>
                      <Select
                        value={result.artisticQualityLevel}
                        onValueChange={(value) => updateResultField("artisticQualityLevel", value as AnalysisResult["artisticQualityLevel"])}
                      >
                        <SelectTrigger className="bg-white">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ممتاز">ممتاز</SelectItem>
                          <SelectItem value="جيد جدًا">جيد جدًا</SelectItem>
                          <SelectItem value="جيد">جيد</SelectItem>
                          <SelectItem value="يحتاج دعم">يحتاج دعم</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>مستوى الأداء</Label>
                      <Select
                        value={result.performanceLevel}
                        onValueChange={(value) => updateResultField("performanceLevel", value as AnalysisResult["performanceLevel"])}
                      >
                        <SelectTrigger className="bg-white">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="يحتاج دعمًا">يحتاج دعمًا</SelectItem>
                          <SelectItem value="في طور التحسن">في طور التحسن</SelectItem>
                          <SelectItem value="متمكن">متمكن</SelectItem>
                          <SelectItem value="متقدم">متقدم</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <Button
                      className="bg-emerald-700 text-white hover:bg-emerald-800"
                      onClick={handleSaveTeacherAdjustment}
                      disabled={updateAnalysisMutation.isPending}
                    >
                      {updateAnalysisMutation.isPending ? (
                        <Loader2 className="ml-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Save className="ml-2 h-4 w-4" />
                      )}
                      حفظ التعديل
                    </Button>
                  </CardContent>
                </Card>

                <div className="grid gap-4 xl:grid-cols-2">
                  {result.analysisSteps && result.analysisSteps.length > 0 ? (
                    <div className="xl:col-span-2">
                      <Accordion type="single" collapsible className="rounded-xl border border-slate-200 bg-white px-4 shadow-sm">
                        <AccordionItem value="analysis-steps" className="border-0">
                          <AccordionTrigger className="text-right text-sm font-semibold text-slate-900 hover:no-underline">
                            عرض خطوات التحليل
                          </AccordionTrigger>
                          <AccordionContent className="pb-4">
                            <div className="grid gap-2 md:grid-cols-2">
                              {result.analysisSteps.map((step, index) => (
                                <div key={`${step}-${index}`} className="rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2">
                                  <p className="text-sm leading-6 text-slate-800">
                                    <span className="ml-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-emerald-700 text-xs font-bold text-white">
                                      {index + 1}
                                    </span>
                                    {step}
                                  </p>
                                </div>
                              ))}
                            </div>
                          </AccordionContent>
                        </AccordionItem>
                      </Accordion>
                    </div>
                  ) : null}
                  <ResultCard title="ملخص التحليل" className="xl:col-span-2">
                    <p className="text-base leading-8 text-slate-800">{result.summary}</p>
                  </ResultCard>
                  <ResultCard title="حالة اكتمال العمل">
                    <div className="flex min-h-24 items-center justify-center rounded-lg bg-sky-50">
                      <Badge className="bg-sky-700 px-4 py-2 text-base text-white">{result.completionStatus}</Badge>
                    </div>
                  </ResultCard>
                  <ResultCard title="مستوى الجودة الفنية">
                    <div className="flex min-h-24 items-center justify-center rounded-lg bg-amber-50">
                      <Badge className="bg-amber-600 px-4 py-2 text-base text-white">{result.artisticQualityLevel}</Badge>
                    </div>
                  </ResultCard>
                  <ResultCard title="مستوى الأداء">
                    <div className="flex min-h-24 items-center justify-center rounded-lg bg-emerald-50">
                      <Badge className="bg-emerald-700 px-4 py-2 text-base text-white">{result.performanceLevel}</Badge>
                    </div>
                  </ResultCard>
                  <ResultCard title="نقاط القوة">
                    <ul className="list-inside list-disc space-y-1">
                      {result.strengths.map((item, index) => (
                        <li key={index}>{item}</li>
                      ))}
                    </ul>
                  </ResultCard>
                  <ResultCard title="جوانب التحسين">
                    <ul className="list-inside list-disc space-y-1">
                      {result.improvements.map((item, index) => (
                        <li key={index}>{item}</li>
                      ))}
                    </ul>
                  </ResultCard>
                  <ResultCard title="التغذية الراجعة للطالب" className="xl:col-span-2">
                    <p className="text-base leading-8 text-slate-800">{result.readyFeedback}</p>
                  </ResultCard>
                  <ResultCard title="النشاط المقترح" className="xl:col-span-2">
                    <p className="text-base leading-8 text-slate-800">{result.suggestedActivity}</p>
                  </ResultCard>
                  <ResultCard title="رسالة قصيرة للطالب">{result.studentMessage}</ResultCard>
                  <ResultCard title="ملاحظات للمعلم">{result.teacherNotes}</ResultCard>
                </div>
              </>
            ) : (
              <Card className="border-slate-200 shadow-sm">
                <CardContent className="flex min-h-64 flex-col items-center justify-center gap-3 text-center text-slate-600">
                  <Bot className="h-10 w-10 text-emerald-700" />
                  <p className="max-w-md text-sm leading-7">
                    اختر عملًا فنيًا ثم اضغط تحليل العمل الفني لعرض النتيجة في بطاقات منظمة قابلة للنسخ.
                  </p>
                </CardContent>
              </Card>
            )}

            {recentAnalysesQuery.data && recentAnalysesQuery.data.length > 0 ? (
              <Card className="border-slate-200 shadow-sm">
                <CardHeader>
                  <CardTitle className="text-base">أحدث التحليلات المحفوظة</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {recentAnalysesQuery.data.slice(0, 5).map((analysis) => (
                    <div key={analysis.id} className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
                      <div className="font-medium text-slate-900">{analysis.artworkTitle || `عمل رقم ${analysis.artworkId}`}</div>
                      <div className="mt-1 text-slate-500">
                        {analysis.studentName || "طالب"} | {analysis.provider === "llm" ? "تحليل AI" : "وضع المعاينة"}
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            ) : null}
          </div>
        </div>
      </main>
    </div>
  );
}
