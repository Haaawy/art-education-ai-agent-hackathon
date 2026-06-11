import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { APP_LOGO, APP_TITLE, getLoginUrl } from "@/const";
import { BrainCircuit, CheckCircle2, LockKeyhole, ShieldCheck } from "lucide-react";
import { Link } from "wouter";

const privacyItems = [
  "منصة arts منصة تعليمية مخصصة للتربية الفنية ومصممة لمساعدة المعلمين والطلاب في إدارة الأعمال الفنية والتعلم البصري.",
  "وكيل الذكاء الاصطناعي يساعد المعلم في تحليل أعمال الطلاب وكتابة تغذية راجعة تربوية منظمة قابلة للمراجعة والاستخدام.",
  "لا يجب إدخال بيانات شخصية حساسة داخل الوكيل، مثل أرقام الهوية أو بيانات التواصل أو أي معلومات غير ضرورية عن الطلاب.",
  "قد تُستخدم بيانات العمل الفني مثل العنوان والوصف والملاحظات التعليمية لتوليد التحليل والتغذية الراجعة.",
  "لا يتم عرض مفاتيح الذكاء الاصطناعي أو مشاركتها مع المستخدمين، وتبقى إعدادات المزود محفوظة في إعدادات الخادم.",
  "استخدام الوكيل والبيانات المرتبطة به يخضع لصلاحيات المستخدم داخل المنصة، ولا يغيّر نظام الوصول الحالي.",
];

export default function Privacy() {
  return (
    <div dir="rtl" className="min-h-screen bg-slate-50 text-slate-950">
      <header className="border-b border-slate-200 bg-white">
        <div className="container flex h-16 items-center justify-between gap-4">
          <Link href="/">
            <div className="flex cursor-pointer items-center gap-3">
              <img src={APP_LOGO} alt="شعار المنصة" className="h-10 w-10 rounded-lg" />
              <div>
                <p className="text-sm text-slate-500">منصة تعليمية للتربية الفنية</p>
                <h1 className="text-base font-bold">{APP_TITLE}</h1>
              </div>
            </div>
          </Link>
          <div className="flex items-center gap-2">
            <Button variant="ghost" asChild>
              <Link href="/terms">شروط الاستخدام</Link>
            </Button>
            <Button asChild>
              <a href={getLoginUrl()}>تسجيل الدخول</a>
            </Button>
          </div>
        </div>
      </header>

      <main className="container py-10 md:py-14">
        <section className="mx-auto max-w-4xl">
          <div className="mb-8 rounded-2xl border border-emerald-100 bg-white p-6 shadow-sm md:p-8">
            <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
              <ShieldCheck className="h-7 w-7" />
            </div>
            <h2 className="mb-3 text-3xl font-bold tracking-normal md:text-4xl">سياسة الخصوصية</h2>
            <p className="max-w-3xl text-base leading-8 text-slate-600">
              توضّح هذه الصفحة كيفية التعامل مع بيانات منصة arts ووكيل معلم التربية الفنية لتحليل أعمال الطلاب عند استخدامه في تحليل
              أعمال الطلاب وكتابة التغذية الراجعة التعليمية.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <Card className="border-slate-200 bg-white">
              <CardHeader>
                <LockKeyhole className="mb-2 h-7 w-7 text-emerald-700" />
                <CardTitle className="text-lg">خصوصية الطلاب</CardTitle>
              </CardHeader>
              <CardContent className="text-sm leading-7 text-slate-600">
                تجنّب إدخال أي بيانات شخصية حساسة، واستخدم المعلومات التعليمية الضرورية فقط لتحسين التحليل.
              </CardContent>
            </Card>
            <Card className="border-slate-200 bg-white">
              <CardHeader>
                <BrainCircuit className="mb-2 h-7 w-7 text-emerald-700" />
                <CardTitle className="text-lg">بيانات التحليل</CardTitle>
              </CardHeader>
              <CardContent className="text-sm leading-7 text-slate-600">
                يعتمد الوكيل على بيانات العمل المتاحة مثل العنوان والوصف وملاحظات المعلم عند توليد النتيجة.
              </CardContent>
            </Card>
            <Card className="border-slate-200 bg-white">
              <CardHeader>
                <ShieldCheck className="mb-2 h-7 w-7 text-emerald-700" />
                <CardTitle className="text-lg">الصلاحيات</CardTitle>
              </CardHeader>
              <CardContent className="text-sm leading-7 text-slate-600">
                الوصول إلى أعمال الطلاب وتحليلها يبقى مرتبطًا بصلاحيات المستخدم داخل المنصة.
              </CardContent>
            </Card>
          </div>

          <Card className="mt-6 border-slate-200 bg-white">
            <CardHeader>
              <CardTitle className="text-xl">ما الذي يجب معرفته؟</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-4">
                {privacyItems.map((item) => (
                  <li key={item} className="flex gap-3 text-sm leading-7 text-slate-700">
                    <CheckCircle2 className="mt-1 h-5 w-5 shrink-0 text-emerald-700" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </section>
      </main>
    </div>
  );
}
