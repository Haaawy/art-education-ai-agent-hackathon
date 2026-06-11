import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, BookOpen, Trophy, PenTool, Plus, BarChart, User, GraduationCap, FileText, Sparkles, Video, AlertCircle, ArrowLeft, Palette, Copy, ExternalLink } from "lucide-react";
import { Link } from "wouter";
import { APP_LOGO, APP_TITLE } from "@/const";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

const COPILOT_AGENT_URL =
  "https://m365.cloud.microsoft/chat/?titleId=T_40a80c99-7f9e-5c95-5bf4-6f4068fc23b0&source=embedded-builder";

export default function TeacherDashboard() {
  const { user, loading, logout } = useAuth();
  
  // الحصول على الإحصائيات
  const { data: stats } = trpc.teacher.getStats.useQuery(undefined, {
    enabled: !!user,
  });
  const { data: myGallerySettings } = trpc.artworks.getMyTeacherGallerySettings.useQuery(undefined, {
    enabled: !!user,
  });
  const regenerateTeacherShareMutation = trpc.artworks.regenerateMyTeacherGalleryShareLink.useMutation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!user || (user.role !== "teacher" && user.role !== "admin")) {
    window.location.href = "/";
    return null;
  }

  const hasStats = stats && (stats.classesCount > 0 || stats.studentsCount > 0);

  const handleCopyTeacherShareLink = async () => {
    if (!myGallerySettings) return;
    const shareSlug = (myGallerySettings as any).shareEnabled ? String((myGallerySettings as any).shareSlug || "") : "";
    if (shareSlug) {
      await navigator.clipboard.writeText(`${window.location.origin}/gallery/teacher/${shareSlug}`);
      toast.success("تم نسخ رابط معرضي العام");
      return;
    }

    const generated = await regenerateTeacherShareMutation.mutateAsync();
    await navigator.clipboard.writeText(`${window.location.origin}/gallery/teacher/${generated.shareSlug}`);
    toast.success("تم تفعيل مشاركة معرضي العام ونسخ الرابط");
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card sticky top-0 z-10 shadow-sm">
        <div className="container flex items-center justify-between h-16">
          <div className="flex items-center gap-3">
            <img src={APP_LOGO} alt="شعار المنصة" className="w-10 h-10" />
            <h1 className="text-xl font-bold">{APP_TITLE}</h1>
          </div>
          
          <div className="flex items-center gap-4">
            <span className="text-sm text-muted-foreground">
              {user.name || "المعلم"}
            </span>
            <Button variant="outline" size="sm" onClick={() => logout()}>
              تسجيل الخروج
            </Button>
            <Button variant="outline" asChild>
              <Link href="/teacher/competitions">
                <Trophy className="ml-2 h-4 w-4" />
                إنشاء مسابقة فنية
              </Link>
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container py-8">
        {/* Page Title */}
        <div className="mb-8">
          <h2 className="text-4xl font-bold text-primary mb-2">
            👨‍🏫 مركز معلم التربية الفنية
          </h2>
          <p className="text-muted-foreground">
            إدارة فصولك وطلابك والأعمال والتقييمات في مكان واحد
          </p>
        </div>

        {/* Key Metrics */}
        {hasStats && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mb-8">
            <Card className="border-2 border-primary/20 hover:shadow-md transition-shadow">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-xs font-medium">الفصول</CardTitle>
                <Users className="h-4 w-4 text-primary" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-primary">{stats?.classesCount || 0}</div>
              </CardContent>
            </Card>

            <Card className="border-2 border-secondary/20 hover:shadow-md transition-shadow">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-xs font-medium">الطلاب</CardTitle>
                <Users className="h-4 w-4 text-secondary" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-secondary">{stats?.studentsCount || 0}</div>
              </CardContent>
            </Card>

            <Card className="border-2 border-accent/20 hover:shadow-md transition-shadow">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-xs font-medium">الأعمال</CardTitle>
                <PenTool className="h-4 w-4 text-accent" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-accent">{stats?.artworksCount || 0}</div>
              </CardContent>
            </Card>

            <Card className="border-2 border-primary/20 hover:shadow-md transition-shadow">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-xs font-medium">التحديات</CardTitle>
                <Trophy className="h-4 w-4 text-primary" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-primary">{stats?.challengesCount || 0}</div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Primary Actions CTA */}
        <div className="mb-8 p-6 rounded-xl bg-gradient-to-r from-primary/5 via-secondary/5 to-accent/5 border-2 border-primary/10">
          <h3 className="text-xl font-bold text-foreground mb-4 flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            ابدأ عملك الآن
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            <Button className="bg-primary hover:bg-primary/90 text-white" asChild>
              <Link href="/teacher/lessons">
                <BookOpen className="ml-2 h-4 w-4" />
                ابدأ درسًا
              </Link>
            </Button>
            <Button className="bg-secondary text-secondary-foreground hover:bg-secondary/90" asChild>
              <Link href="/teacher/challenges">
                <Plus className="ml-2 h-4 w-4" />
                أنشئ تحديًا
              </Link>
            </Button>
            <Button className="bg-accent text-accent-foreground hover:bg-accent/90" asChild>
              <Link href="/teacher/artworks">
                <PenTool className="ml-2 h-4 w-4" />
                راجع أعمالاً
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/teacher/artworks">
                <Palette className="ml-2 h-4 w-4" />
                معرض أعمال الطلاب
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/teacher/ai-art-agent">
                <Sparkles className="ml-2 h-4 w-4" />
                الوكيل الذكي
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/teacher/certificates-management">
                <GraduationCap className="ml-2 h-4 w-4" />
                امنح شهادة
              </Link>
            </Button>
          </div>
        </div>

        <Card className="mb-8 border-2 border-sky-100 bg-sky-50/70">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg text-sky-950">
              <Sparkles className="h-5 w-5 text-sky-700" />
              وكيل Microsoft Copilot
            </CardTitle>
            <CardDescription className="text-sky-900">
              نسخة موازية من وكيل معلم التربية الفنية لتحليل أعمال الطلاب داخل بيئة Microsoft 365.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="bg-sky-700 text-white hover:bg-sky-800" asChild>
              <a href={COPILOT_AGENT_URL} target="_blank" rel="noreferrer">
                <ExternalLink className="ml-2 h-4 w-4" />
                فتح في Copilot
              </a>
            </Button>
          </CardContent>
        </Card>

        {/* Attention Section */}
        <section className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <AlertCircle className="h-6 w-6 text-orange-500" />
              ما يحتاج انتباهك
            </h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Recent Artworks */}
            <Card className="border-2 border-orange-200 hover:shadow-md transition-shadow">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <PenTool className="h-5 w-5 text-orange-500" />
                  الأعمال الفنية الأخيرة
                </CardTitle>
                <CardDescription>
                  {stats?.artworksCount || 0} أعمال فنية تنتظر المراجعة
                </CardDescription>
              </CardHeader>
              <CardContent>
                {stats?.artworksCount && stats.artworksCount > 0 ? (
                  <Button className="w-full bg-orange-500 hover:bg-orange-600 text-white" asChild>
                    <Link href="/teacher/artworks">
                      مراجعة الأعمال
                      <ArrowLeft className="ml-2 h-4 w-4" />
                    </Link>
                  </Button>
                ) : (
                  <p className="text-sm text-muted-foreground">لا توجد أعمال حالياً</p>
                )}
              </CardContent>
            </Card>

            {/* Classes Overview */}
            <Card className="border-2 border-blue-200 hover:shadow-md transition-shadow">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Users className="h-5 w-5 text-blue-500" />
                  الفصول والطلاب
                </CardTitle>
                <CardDescription>
                  {stats?.classesCount || 0} فصل و {stats?.studentsCount || 0} طالب
                </CardDescription>
              </CardHeader>
              <CardContent>
                {stats?.classesCount && stats.classesCount > 0 ? (
                  <Button className="w-full" variant="outline" asChild>
                    <Link href="/teacher/classes">
                      إدارة الفصول
                      <ArrowLeft className="ml-2 h-4 w-4" />
                    </Link>
                  </Button>
                ) : (
                  <p className="text-sm text-muted-foreground">ابدأ بإنشاء فصول جديدة</p>
                )}
              </CardContent>
            </Card>
          </div>
        </section>

        {/* Quick Action Cards */}
        <section>
          <h3 className="text-2xl font-bold text-foreground mb-4 flex items-center gap-2">
            <Sparkles className="h-6 w-6 text-primary" />
            أدوات الإدارة الرئيسية
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {/* Classes */}
            <Card className="hover:shadow-lg transition-all border-2 border-primary/10 hover:border-primary/30">
              <CardHeader>
                <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
                  <Users className="h-6 w-6 text-primary" />
                </div>
                <CardTitle>إدارة الفصول</CardTitle>
                <CardDescription>
                  إنشاء وإدارة الفصول وإضافة الطلاب
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button className="w-full bg-primary hover:bg-primary/90" asChild>
                  <Link href="/teacher/classes">
                    <Users className="ml-2 h-4 w-4" />
                    إدارة الفصول
                  </Link>
                </Button>
              </CardContent>
            </Card>

            {/* Lessons Management */}
            <Card className="hover:shadow-lg transition-all border-2 border-secondary/10 hover:border-secondary/30">
              <CardHeader>
                <div className="w-12 h-12 rounded-lg bg-secondary/10 flex items-center justify-center mb-4">
                  <BookOpen className="h-6 w-6 text-secondary" />
                </div>
                <CardTitle>إدارة الدروس</CardTitle>
                <CardDescription>
                  إنشاء وتحرير وإدارة الدروس التعليمية
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button className="w-full" variant="secondary" asChild>
                  <Link href="/teacher/lessons-management">
                    <Plus className="ml-2 h-4 w-4" />
                    إدارة الدروس
                  </Link>
                </Button>
              </CardContent>
            </Card>

            {/* Artworks Review */}
            <Card className="hover:shadow-lg transition-all border-2 border-accent/10 hover:border-accent/30">
              <CardHeader>
                <div className="w-12 h-12 rounded-lg bg-accent/10 flex items-center justify-center mb-4">
                  <PenTool className="h-6 w-6 text-accent" />
                </div>
                <CardTitle>تقييم الأعمال</CardTitle>
                <CardDescription>
                  مشاهدة وتقييم الأعمال الفنية للطلاب
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button className="w-full" variant="outline" asChild>
                  <Link href="/teacher/artworks">
                    <PenTool className="ml-2 h-4 w-4" />
                    تقييم الأعمال
                  </Link>
                </Button>
              </CardContent>
            </Card>

            <Card className="hover:shadow-lg transition-all border-2 border-sky-100 hover:border-sky-300">
              <CardHeader>
                <div className="w-12 h-12 rounded-lg bg-sky-100 flex items-center justify-center mb-4">
                  <Palette className="h-6 w-6 text-sky-700" />
                </div>
                <CardTitle>معرض أعمال الطلاب</CardTitle>
                <CardDescription>
                  دخول سريع إلى معارض الفصول والطلاب ضمن نفس الهوية البصرية الجديدة
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <Button className="w-full bg-sky-700 hover:bg-sky-800 text-white" asChild>
                    <Link href="/teacher/artworks">
                      <Palette className="ml-2 h-4 w-4" />
                      افتح المعرض
                    </Link>
                  </Button>
                  <Button className="w-full" variant="outline" onClick={handleCopyTeacherShareLink}>
                    <Copy className="ml-2 h-4 w-4" />
                    نسخ رابط المشاركة
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Challenges */}
            <Card className="hover:shadow-lg transition-all border-2 border-primary/10 hover:border-primary/30">
              <CardHeader>
                <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
                  <Trophy className="h-6 w-6 text-primary" />
                </div>
                <CardTitle>إنشاء تحديات</CardTitle>
                <CardDescription>
                  إنشاء وإدارة التحديات الفنية للطلاب
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button className="w-full" asChild>
                  <Link href="/teacher/challenges">
                    <Plus className="ml-2 h-4 w-4" />
                    إدارة التحديات
                  </Link>
                </Button>
              </CardContent>
            </Card>

            {/* Grades */}
            <Card className="hover:shadow-lg transition-all border-2 border-secondary/10 hover:border-secondary/30">
              <CardHeader>
                <div className="w-12 h-12 rounded-lg bg-secondary/10 flex items-center justify-center mb-4">
                  <FileText className="h-6 w-6 text-secondary" />
                </div>
                <CardTitle>كشوف الدرجات</CardTitle>
                <CardDescription>
                  إدارة وطباعة درجات الطلاب
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button className="w-full" variant="secondary" asChild>
                  <Link href="/teacher/grades">
                    <FileText className="ml-2 h-4 w-4" />
                    عرض الدرجات
                  </Link>
                </Button>
              </CardContent>
            </Card>

            {/* Certificates */}
            <Card className="hover:shadow-lg transition-all border-2 border-accent/10 hover:border-accent/30">
              <CardHeader>
                <div className="w-12 h-12 rounded-lg bg-accent/10 flex items-center justify-center mb-4">
                  <GraduationCap className="h-6 w-6 text-accent" />
                </div>
                <CardTitle>إدارة الشهادات</CardTitle>
                <CardDescription>
                  إعداد قالب الشهادات ومنح الشهادات
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button className="w-full" variant="outline" asChild>
                  <Link href="/teacher/certificates-management">
                    <GraduationCap className="ml-2 h-4 w-4" />
                    إدارة الشهادات
                  </Link>
                </Button>
              </CardContent>
            </Card>

            {/* Attendance */}
            <Card className="hover:shadow-lg transition-all border-2 border-primary/10 hover:border-primary/30">
              <CardHeader>
                <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
                  <BarChart className="h-6 w-6 text-primary" />
                </div>
                <CardTitle>الحضور والمتابعة</CardTitle>
                <CardDescription>
                  تسجيل الحضور والمشاركة اليومية
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button className="w-full" asChild>
                  <Link href="/teacher/attendance">
                    <BarChart className="ml-2 h-4 w-4" />
                    تسجيل الحضور
                  </Link>
                </Button>
              </CardContent>
            </Card>

            {/* Video Library */}
            <Card className="hover:shadow-lg transition-all border-2 border-secondary/10 hover:border-secondary/30">
              <CardHeader>
                <div className="w-12 h-12 rounded-lg bg-secondary/10 flex items-center justify-center mb-4">
                  <Video className="h-6 w-6 text-secondary" />
                </div>
                <CardTitle>مكتبة الفيديوهات</CardTitle>
                <CardDescription>
                  إدارة الفيديوهات الخارجية والتحميل
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button className="w-full" variant="secondary" asChild>
                  <Link href="/teacher/video-library">
                    <Video className="ml-2 h-4 w-4" />
                    فتح المكتبة
                  </Link>
                </Button>
              </CardContent>
            </Card>

            {/* Statistics */}
            <Card className="hover:shadow-lg transition-all border-2 border-accent/10 hover:border-accent/30">
              <CardHeader>
                <div className="w-12 h-12 rounded-lg bg-accent/10 flex items-center justify-center mb-4">
                  <BarChart className="h-6 w-6 text-accent" />
                </div>
                <CardTitle>التقارير والإحصائيات</CardTitle>
                <CardDescription>
                  عرض تقارير الأداء والإحصائيات التفصيلية
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button className="w-full" variant="outline" asChild>
                  <Link href="/teacher/statistics">
                    <BarChart className="ml-2 h-4 w-4" />
                    عرض التقارير
                  </Link>
                </Button>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* Additional Tools */}
        <section className="mt-8">
          <h3 className="text-2xl font-bold text-foreground mb-4">أدوات إضافية</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {/* Learning Paths */}
            <Card className="hover:shadow-lg transition-all border-2 border-border hover:border-primary/30">
              <CardHeader>
                <div className="w-12 h-12 rounded-lg bg-primary/5 flex items-center justify-center mb-4">
                  <GraduationCap className="h-6 w-6 text-primary" />
                </div>
                <CardTitle className="text-base">المسارات التعليمية</CardTitle>
              </CardHeader>
              <CardContent>
                <Button className="w-full" size="sm" variant="outline" asChild>
                  <Link href="/teacher/learning-paths">إدارة</Link>
                </Button>
              </CardContent>
            </Card>

            {/* Badges */}
            <Card className="hover:shadow-lg transition-all border-2 border-border hover:border-secondary/30">
              <CardHeader>
                <div className="w-12 h-12 rounded-lg bg-secondary/5 flex items-center justify-center mb-4">
                  <Trophy className="h-6 w-6 text-secondary" />
                </div>
                <CardTitle className="text-base">شارات الطلاب</CardTitle>
              </CardHeader>
              <CardContent>
                <Button className="w-full" size="sm" variant="outline" asChild>
                  <Link href="/teacher/badges">إدارة</Link>
                </Button>
              </CardContent>
            </Card>

            {/* Gifted Students */}
            <Card className="hover:shadow-lg transition-all border-2 border-border hover:border-accent/30">
              <CardHeader>
                <div className="w-12 h-12 rounded-lg bg-accent/5 flex items-center justify-center mb-4">
                  <Sparkles className="h-6 w-6 text-accent" />
                </div>
                <CardTitle className="text-base">الطلاب الموهوبين</CardTitle>
              </CardHeader>
              <CardContent>
                <Button className="w-full" size="sm" variant="outline" asChild>
                  <Link href="/teacher/gifted-students">إدارة</Link>
                </Button>
              </CardContent>
            </Card>

            {/* Profile */}
            <Card className="hover:shadow-lg transition-all border-2 border-border hover:border-primary/30">
              <CardHeader>
                <div className="w-12 h-12 rounded-lg bg-primary/5 flex items-center justify-center mb-4">
                  <User className="h-6 w-6 text-primary" />
                </div>
                <CardTitle className="text-base">البيانات الشخصية</CardTitle>
              </CardHeader>
              <CardContent>
                <Button className="w-full" size="sm" variant="outline" asChild>
                  <Link href="/teacher/profile">تحديث</Link>
                </Button>
              </CardContent>
            </Card>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="py-6 mt-12 border-t border-border bg-muted/30">
        <div className="container text-center text-sm text-muted-foreground">
          <p>جميع الحقوق محفوظه © منصة التربية الفنية</p>
        </div>
      </footer>
    </div>
  );
}
