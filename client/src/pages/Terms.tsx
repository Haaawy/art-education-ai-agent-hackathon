import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { APP_LOGO, APP_TITLE, getLoginUrl } from "@/const";
import { BookOpenCheck, CheckCircle2, GraduationCap, Scale } from "lucide-react";
import { Link } from "wouter";

const termsItems = [
  "وكيل معلم التربية الفنية لتحليل أعمال الطلاب أداة مساعدة للمعلم، وليس بديلًا عن حكم المعلم التربوي أو معرفته بسياق الطالب والدرس.",
  "نتائج الذكاء الاصطناعي يجب مراجعتها قبل اعتمادها أو مشاركتها مع الطالب أو استخدامها كتغذية راجعة نهائية.",
  "يمنع إدخال بيانات شخصية حساسة أو معلومات غير ضرورية عن الطلاب داخل الوكيل أو أمثلة العرض.",
  "يجب استخدام الوكيل لأغراض تعليمية مرتبطة بالتربية الفنية وتحسين التغذية الراجعة والتعلم.",
  "قد تحتاج النتائج إلى تعديل حسب سياق الدرس، المرحلة العمرية، أهداف النشاط، ومستوى الطالب الفعلي.",
];

export default function Terms() {
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
              <Link href="/privacy">سياسة الخصوصية</Link>
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
              <Scale className="h-7 w-7" />
            </div>
            <h2 className="mb-3 text-3xl font-bold tracking-normal md:text-4xl">شروط الاستخدام</h2>
            <p className="max-w-3xl text-base leading-8 text-slate-600">
              توضّح هذه الشروط طريقة استخدام منصة arts ووكيل معلم التربية الفنية لتحليل أعمال الطلاب بوصفه أداة تعليمية مساعدة
              للمعلم في تحليل أعمال الطلاب وصياغة التغذية الراجعة.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <Card className="border-slate-200 bg-white">
              <CardHeader>
                <GraduationCap className="mb-2 h-7 w-7 text-emerald-700" />
                <CardTitle className="text-lg">دور المعلم</CardTitle>
              </CardHeader>
              <CardContent className="text-sm leading-7 text-slate-600">
                تبقى مراجعة المعلم وحكمه التربوي أساس اعتماد أي ملاحظة أو تغذية راجعة.
              </CardContent>
            </Card>
            <Card className="border-slate-200 bg-white">
              <CardHeader>
                <BookOpenCheck className="mb-2 h-7 w-7 text-emerald-700" />
                <CardTitle className="text-lg">استخدام تعليمي</CardTitle>
              </CardHeader>
              <CardContent className="text-sm leading-7 text-slate-600">
                يستخدم الوكيل لدعم التعلم والتقييم البنائي داخل سياق التربية الفنية فقط.
              </CardContent>
            </Card>
            <Card className="border-slate-200 bg-white">
              <CardHeader>
                <Scale className="mb-2 h-7 w-7 text-emerald-700" />
                <CardTitle className="text-lg">مراجعة النتائج</CardTitle>
              </CardHeader>
              <CardContent className="text-sm leading-7 text-slate-600">
                قد تحتاج المخرجات إلى تعديل لغوي أو تربوي حسب عمر الطالب وهدف الدرس.
              </CardContent>
            </Card>
          </div>

          <Card className="mt-6 border-slate-200 bg-white">
            <CardHeader>
              <CardTitle className="text-xl">الشروط الأساسية</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-4">
                {termsItems.map((item) => (
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
