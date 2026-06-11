import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Eye, MoreHorizontal, Sparkles, Trash2 } from "lucide-react";
import { Link, useParams } from "wouter";
import { APP_LOGO } from "@/const";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useMemo, useState } from "react";
import ArtworkGalleryCard from "@/components/gallery/ArtworkGalleryCard";
import ArtworkGalleryGrid from "@/components/gallery/ArtworkGalleryGrid";
import ArtworkLightbox from "@/components/gallery/ArtworkLightbox";
import { getArtworkCategoryOption, getArtworkImageUrl } from "@/lib/gallery";
import PageBackButton from "@/components/PageBackButton";

export default function TeacherClassArtworks() {
  const { user, loading } = useAuth();
  const utils = trpc.useUtils();
  const params = useParams();
  const classId = Number(params.id || 0);

  const { data: classData, isLoading: classLoading } = trpc.classes.getById.useQuery(
    { classId },
    { enabled: classId > 0 }
  );

  const [studentFilter, setStudentFilter] = useState("all");
  const [challengeFilter, setChallengeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [featuredFilter, setFeaturedFilter] = useState("all");
  const [competitionSelection, setCompetitionSelection] = useState<Record<number, string>>({});
  const [failedImages, setFailedImages] = useState<Record<number, true>>({});
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  const {
    data: artworks = [],
    isLoading: artworksLoading,
    error,
  } = trpc.artworks.getByClass.useQuery(
    { classId },
    { enabled: classId > 0 && !!user && (user.role === "teacher" || user.role === "admin") }
  );

  const { data: competitions = [] } = trpc.competitions.getAdminList.useQuery(undefined, {
    enabled: user?.role === "admin",
  });

  const setPublicStatus = trpc.artworks.setPublicStatus.useMutation({
    onSuccess: () => {
      utils.artworks.getByClass.invalidate({ classId });
      utils.artworks.getPublic.invalidate();
    },
    onError: (error) => {
      toast.error(error.message || "تعذر تحديث حالة العرض");
    },
  });

  const deleteArtwork = trpc.artworks.delete.useMutation({
    onSuccess: () => {
      toast.success("تم حذف العمل الفني");
      utils.artworks.getByClass.invalidate({ classId });
      utils.artworks.getPublic.invalidate();
    },
    onError: (error) => {
      toast.error(error.message || "تعذر حذف العمل الفني");
    },
  });

  const updateSubmissionStatus = trpc.challenges.updateSubmissionStatus.useMutation({
    onSuccess: () => {
      toast.success("تم تحديث حالة التسليم");
      utils.artworks.getByClass.invalidate({ classId });
    },
    onError: (error) => {
      toast.error(error.message || "تعذر تحديث حالة التسليم");
    },
  });

  const addReview = trpc.reviews.create.useMutation({
    onSuccess: () => {
      toast.success("تم حفظ تعليق المعلم");
      utils.artworks.getByClass.invalidate({ classId });
    },
    onError: (error) => {
      toast.error(error.message || "تعذر حفظ التعليق");
    },
  });

  const updateWorkflow = trpc.artworks.updateWorkflow.useMutation({
    onSuccess: () => {
      toast.success("تم تحديث حالة العمل");
      utils.artworks.getByClass.invalidate({ classId });
      utils.artworks.getPublic.invalidate();
    },
    onError: (error) => {
      toast.error(error.message || "تعذر تحديث حالة العمل");
    },
  });

  const setTeacherGalleryVisibility = trpc.artworks.setTeacherGalleryVisibility.useMutation({
    onSuccess: () => {
      toast.success("تم تحديث ظهور العمل في معرض المعلم");
      utils.artworks.getByClass.invalidate({ classId });
    },
    onError: (error) => {
      toast.error(error.message || "تعذر تحديث ظهور العمل في معرض المعلم");
    },
  });

  const setSiteGalleryVisibility = trpc.artworks.setSiteGalleryVisibility.useMutation({
    onSuccess: () => {
      toast.success("تم تحديث ظهور العمل في معرض الموقع");
      utils.artworks.getByClass.invalidate({ classId });
      utils.artworks.getPublic.invalidate();
    },
    onError: (error) => {
      toast.error(error.message || "تعذر تحديث ظهور العمل في معرض الموقع");
    },
  });

  const assignArtworkToCompetition = trpc.competitions.assignArtwork.useMutation({
    onSuccess: () => {
      toast.success("تمت إضافة العمل إلى المسابقة");
      utils.artworks.getByClass.invalidate({ classId });
      utils.competitions.getById.invalidate();
      utils.competitions.getActive.invalidate();
    },
    onError: (error) => {
      toast.error(error.message || "تعذر إضافة العمل إلى المسابقة");
    },
  });

  const removeArtworkFromCompetition = trpc.competitions.removeArtwork.useMutation({
    onSuccess: () => {
      toast.success("تمت إزالة العمل من المسابقة");
      utils.artworks.getByClass.invalidate({ classId });
      utils.competitions.getById.invalidate();
      utils.competitions.getActive.invalidate();
    },
    onError: (error) => {
      toast.error(error.message || "تعذر إزالة العمل من المسابقة");
    },
  });

  const handleDelete = (artworkId: number) => {
    if (!window.confirm("هل تريد حذف هذا العمل الفني نهائياً؟")) return;
    deleteArtwork.mutate({ artworkId });
  };

  const generateAiFeedback = trpc.artworks.generateAiFeedback.useMutation({
    onSuccess: () => {
      toast.success("تم حفظ اقتراح الذكاء الاصطناعي كمسودة داخلية للمعلم");
      utils.artworks.getByClass.invalidate({ classId });
    },
    onError: (error) => {
      toast.error(error.message || "تعذر توليد اقتراح الذكاء الاصطناعي");
    },
  });

  const handleGenerateAiDraft = (artworkId: number) => {
    generateAiFeedback.mutate({ artworkId });
  };

  const handleApplyAiDraftAsFinalReview = async (artworkId: number) => {
    try {
      const aiDraft = await utils.artworks.getAiFeedback.fetch({ artworkId });
      const suggestedComment = [aiDraft?.strength, aiDraft?.improvement, aiDraft?.encouragement]
        .filter((part) => Boolean(part && String(part).trim()))
        .join("\n");

      if (!suggestedComment) {
        toast.error("لا توجد مسودة ذكاء اصطناعي لهذا العمل. استخدم زر التوليد أولاً.");
        return;
      }

      const comment = (window.prompt("راجع النص قبل الاعتماد النهائي للطالب:", suggestedComment) || "").trim();
      const ratingInput = (window.prompt("أدخل التقييم النهائي من 1 إلى 5 (اختياري):") || "").trim();
      const parsedRating = Number(ratingInput);
      const hasRating = Number.isFinite(parsedRating) && parsedRating >= 1 && parsedRating <= 5;

      if (!comment && !ratingInput) {
        toast.error("لم يتم اعتماد أي نص نهائي");
        return;
      }

      if (ratingInput && !hasRating) {
        toast.error("التقييم يجب أن يكون رقمًا من 1 إلى 5");
        return;
      }

      addReview.mutate({
        artworkId,
        comment: comment || undefined,
        rating: hasRating ? parsedRating : undefined,
      });
    } catch (error: any) {
      toast.error(error?.message || "تعذر قراءة مسودة الذكاء الاصطناعي");
    }
  };

  const handleSubmissionStatus = (
    challengeId: number | null | undefined,
    artworkId: number,
    status: "approved" | "rejected"
  ) => {
    if (!challengeId) {
      toast.error("هذا العمل غير مرتبط بمهمة");
      return;
    }

    updateSubmissionStatus.mutate({
      challengeId,
      artworkId,
      status,
    });
  };

  const handleAddCommentAndRating = (artworkId: number) => {
    const commentRaw = window.prompt("اكتب تعليق المعلم على العمل (اختياري):") || "";
    const ratingRaw = window.prompt("أدخل التقييم من 1 إلى 5 (اختياري):") || "";

    const trimmedComment = commentRaw.trim();
    const parsedRating = Number(ratingRaw);
    const hasRating = Number.isFinite(parsedRating) && parsedRating >= 1 && parsedRating <= 5;

    if (!trimmedComment && !ratingRaw.trim()) {
      toast.error("أدخل تعليقًا أو تقييمًا على الأقل");
      return;
    }

    if (ratingRaw.trim() && !hasRating) {
      toast.error("التقييم يجب أن يكون رقمًا من 1 إلى 5");
      return;
    }

    addReview.mutate({ artworkId, comment: trimmedComment || undefined, rating: hasRating ? parsedRating : undefined });
  };

  const statusBadgeClass = (status: "draft" | "submitted" | "reviewed" | "published" | null | undefined) => {
    if (status === "published") return "bg-emerald-100 text-emerald-700 border-emerald-300";
    if (status === "reviewed") return "bg-sky-100 text-sky-700 border-sky-300";
    if (status === "draft") return "bg-slate-100 text-slate-700 border-slate-300";
    return "bg-amber-100 text-amber-700 border-amber-300";
  };

  const statusLabel = (status: "draft" | "submitted" | "reviewed" | "published" | null | undefined) => {
    if (status === "published") return "منشور";
    if (status === "reviewed") return "مُراجَع";
    if (status === "draft") return "مسودة";
    return "مُرسل";
  };

  const studentOptions = useMemo(() => {
    const entries = artworks
      .map((artwork) => ({
        id: String(artwork.studentId),
        name: artwork.studentName || `طالب #${artwork.studentId}`,
      }))
      .filter((item, index, self) => self.findIndex((candidate) => candidate.id === item.id) === index)
      .sort((a, b) => a.name.localeCompare(b.name, "ar"));
    return entries;
  }, [artworks]);

  const challengeOptions = useMemo(() => {
    const entries = artworks
      .filter((artwork) => artwork.challengeId && artwork.challengeTitle)
      .map((artwork) => ({
        id: String(artwork.challengeId),
        title: artwork.challengeTitle || `Challenge #${artwork.challengeId}`,
      }))
      .filter((item, index, self) => self.findIndex((candidate) => candidate.id === item.id) === index)
      .sort((a, b) => a.title.localeCompare(b.title, "ar"));
    return entries;
  }, [artworks]);

  const filteredArtworks = useMemo(() => {
    return artworks.filter((artwork) => {
      if (studentFilter !== "all" && String(artwork.studentId) !== studentFilter) {
        return false;
      }

      if (challengeFilter !== "all") {
        if (challengeFilter === "none") {
          if (artwork.challengeId) return false;
        } else if (String(artwork.challengeId || "") !== challengeFilter) {
          return false;
        }
      }

      if (statusFilter !== "all" && artwork.status !== statusFilter) {
        return false;
      }

      if (featuredFilter === "featured" && !artwork.isFeatured) {
        return false;
      }

      if (featuredFilter === "not-featured" && artwork.isFeatured) {
        return false;
      }

      return true;
    });
  }, [artworks, challengeFilter, featuredFilter, statusFilter, studentFilter]);

  const normalizedFilteredArtworks = useMemo(
    () =>
      filteredArtworks.map((artwork) => ({
        ...artwork,
        imageUrl: getArtworkImageUrl(artwork as any),
        category: getArtworkCategoryOption(artwork as any),
      })),
    [filteredArtworks],
  );

        const lightboxItems = useMemo(
          () =>
            normalizedFilteredArtworks.map((artwork) => ({
              id: artwork.id,
              title: artwork.title || "عمل فني",
              fullImageUrl: (artwork as any).fullImageUrl,
              imageUrl: artwork.imageUrl,
              thumbnailUrl: (artwork as any).thumbnailUrl,
              imageKeyResolvedUrl: (artwork as any).imageKeyResolvedUrl,
              categoryLabel: artwork.category.label,
              studentName: artwork.studentName || "طالب",
              description: artwork.description || "",
              createdAtLabel: artwork.createdAt ? new Date(artwork.createdAt).toLocaleDateString("ar-SA") : "غير محدد",
            })),
          [normalizedFilteredArtworks],
        );
  const userFacingErrorMessage = (() => {
    if (!error?.message) return "حدث خطأ أثناء تحميل الأعمال. حاول مرة أخرى.";
    if (error.message.toLowerCase().includes("failed query")) {
      return "تعذر عرض الأعمال حاليًا بسبب مشكلة تقنية مؤقتة. يرجى إعادة المحاولة بعد قليل.";
    }
    return "تعذر عرض الأعمال حاليًا. حاول التحديث مرة أخرى.";
  })();

  if (loading || classLoading || artworksLoading) {
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

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card sticky top-0 z-10">
        <div className="container flex items-center justify-between h-16">
          <div className="flex items-center gap-3">
            <PageBackButton label="العودة إلى الفصل" fallbackPath={`/teacher/class/${classId}`} />
            <img src={APP_LOGO} alt="شعار المنصة" className="w-10 h-10" />
            <h1 className="text-xl font-bold">إدارة أعمال الطلاب - {classData?.name || "الفصل"}</h1>
          </div>
          <Button variant="outline" asChild>
            <Link href={`/teacher/class/${classId}/gallery`}>معرض الفصل</Link>
          </Button>
        </div>
      </header>

      <main className="container py-8">
        <Card className="mb-6">
          <CardContent className="pt-6">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
              <Select value={studentFilter} onValueChange={setStudentFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="الطالب" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الطلاب: الكل</SelectItem>
                  {studentOptions.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={challengeFilter} onValueChange={setChallengeFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="المهمة" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">المهام: الكل</SelectItem>
                  <SelectItem value="none">المهمة: رسم حر</SelectItem>
                  {challengeOptions.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="الحالة" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الحالة: الكل</SelectItem>
                  <SelectItem value="submitted">مُرسل</SelectItem>
                  <SelectItem value="reviewed">مُراجَع</SelectItem>
                  <SelectItem value="published">منشور</SelectItem>
                </SelectContent>
              </Select>

              <Select value={featuredFilter} onValueChange={setFeaturedFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="التمييز" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">التمييز: الكل</SelectItem>
                  <SelectItem value="featured">المميزة فقط</SelectItem>
                  <SelectItem value="not-featured">غير المميزة</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {error ? (
          <Card className="text-center py-12">
            <CardContent>
              <h3 className="text-xl font-bold mb-2">لا يمكن عرض الأعمال</h3>
              <p className="text-muted-foreground">{userFacingErrorMessage}</p>
            </CardContent>
          </Card>
        ) : artworks.length === 0 ? (
          <Card className="text-center py-12">
            <CardContent>
              <Eye className="h-16 w-16 mx-auto mb-4 text-muted-foreground" />
              <h3 className="text-xl font-bold mb-2">لا توجد أعمال فنية لهذا الفصل</h3>
              <p className="text-muted-foreground">ستظهر الأعمال هنا عند قيام الطلاب برفعها.</p>
            </CardContent>
          </Card>
        ) : filteredArtworks.length === 0 ? (
          <Card className="text-center py-12">
            <CardContent>
              <h3 className="text-xl font-bold mb-2">لا توجد نتائج مطابقة للفلاتر</h3>
              <p className="text-muted-foreground">غيّر الفلاتر لعرض أعمال أخرى.</p>
            </CardContent>
          </Card>
        ) : (
          <ArtworkGalleryGrid className="xl:grid-cols-3">
            {normalizedFilteredArtworks.map((artwork, index) => (
              <ArtworkGalleryCard
                key={artwork.id}
                artwork={{
                  id: artwork.id,
                  title: artwork.title,
                  description: artwork.description,
                  imageUrl: artwork.imageUrl,
                  imageKey: artwork.imageKey,
                  studentName: artwork.studentName,
                  className: classData?.name,
                  createdAt: artwork.createdAt,
                }}
                categoryLabel={artwork.category.label}
                metricLabel={artwork.showInSiteGallery ? "معرض الموقع" : artwork.showInTeacherGallery ? "معرض المعلم" : null}
                onOpen={() => setPreviewIndex(index)}
                infoSlot={
                  <>
                  <h3 className="font-bold mb-1">{artwork.title}</h3>
                  <p className="text-sm text-muted-foreground mb-1">
                    الطالب: {artwork.studentName || "طالب"}
                  </p>
                  {artwork.description && (
                    <p className="text-sm text-muted-foreground mb-2">{artwork.description}</p>
                  )}

                  {artwork.challengeTitle && (
                    <p className="mb-2 rounded-md bg-primary/10 px-2 py-1 text-xs text-primary">
                      مهمة مرتبطة: {artwork.challengeTitle}
                    </p>
                  )}

                  <p className={`mb-2 inline-flex rounded-md border px-2 py-1 text-xs font-semibold ${statusBadgeClass(artwork.status)}`}>
                    حالة العمل: {statusLabel(artwork.status)}
                  </p>

                  {artwork.isFeatured && (
                    <p className="mb-2 inline-flex rounded-md border border-amber-300 bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-700">
                      ⭐ عمل مميز
                    </p>
                  )}

                  {artwork.showInSiteGallery && (
                    <p className="mb-2 inline-flex rounded-md border border-cyan-300 bg-cyan-100 px-2 py-1 text-xs font-semibold text-cyan-800">
                      🌍 معرض الموقع
                    </p>
                  )}

                  {artwork.submissionStatus && (
                    <p className="mb-2 text-xs text-muted-foreground">
                      حالة تسليم المهمة: {artwork.submissionStatus === "approved" ? "✅ مقبول" : artwork.submissionStatus === "rejected" ? "❌ مرفوض" : "⏳ قيد المراجعة"}
                    </p>
                  )}

                  {artwork.latestTeacherRating && (
                    <p className="mb-2 text-xs text-amber-700">
                      آخر تقييم: {artwork.latestTeacherRating}/5
                    </p>
                  )}

                  {artwork.latestTeacherComment && (
                    <p className="mb-2 rounded-md border border-border/70 bg-muted/30 px-2 py-1 text-xs text-muted-foreground">
                      آخر تعليق: {artwork.latestTeacherComment}
                    </p>
                  )}

                  {artwork.aiGeneratedAt && (
                    <p className="mb-2 rounded-md border border-sky-200 bg-sky-50 px-2 py-1 text-xs text-sky-800">
                      مسودة ذكاء اصطناعي داخلية محدثة: {new Date(artwork.aiGeneratedAt).toLocaleString("ar-SA")}
                    </p>
                  )}

                  <p className="text-xs mb-2">
                    {artwork.isPublic ? "✅ معتمد في المعرض" : "⏳ غير معتمد"}
                  </p>
                  <p className="text-xs mb-2">
                    {artwork.showInTeacherGallery
                      ? "👁️ ظاهر في معرض المعلم"
                      : "🚫 مخفي من معرض المعلم"}
                  </p>
                  <p className="text-xs mb-2">
                    {artwork.showInSiteGallery
                      ? "🌍 ظاهر في معرض الموقع"
                      : "🚫 مخفي من معرض الموقع"}
                  </p>
                  <p className="text-xs mb-2">
                    {artwork.showInCompetition
                      ? `🏆 مشارك في مسابقة #${artwork.competitionId || "-"}`
                      : "🚫 غير مشارك في أي مسابقة"}
                  </p>
                  {artwork.showInCompetition && artwork.competitionVotes > 0 && (
                    <p className="text-xs mb-2 text-amber-700">أصوات المسابقة: {artwork.competitionVotes}</p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {new Date(artwork.createdAt).toLocaleDateString("ar-SA")}
                  </p>
                  </>
                }
                actionSlot={
                  <div className="mt-4 space-y-3" dir="rtl">
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="default"
                        onClick={() => handleAddCommentAndRating(artwork.id)}
                        disabled={addReview.isPending}
                      >
                        مراجعة العمل
                      </Button>

                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setPublicStatus.mutate({ artworkId: artwork.id, isPublic: !Boolean(artwork.isPublic) })
                        }
                        disabled={setPublicStatus.isPending}
                      >
                        {artwork.isPublic ? "إلغاء النشر" : "اعتماد ونشر"}
                      </Button>

                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void handleApplyAiDraftAsFinalReview(artwork.id)}
                        disabled={addReview.isPending}
                      >
                        اعتماد وصف العمل
                      </Button>
                    </div>

                    <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3">
                      <p className="mb-3 text-xs font-semibold text-emerald-900">إجراءات الذكاء الاصطناعي</p>
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                        <div className="rounded-md border border-emerald-100 bg-white p-3">
                          <p className="mb-1 text-sm font-semibold text-slate-900">اقتراح وصف للعمل</p>
                          <p className="mb-3 text-xs leading-5 text-slate-600">
                            يساعدك في كتابة وصف مناسب للعمل الفني قبل النشر.
                          </p>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleGenerateAiDraft(artwork.id)}
                            disabled={generateAiFeedback.isPending}
                            className="w-full"
                          >
                            <Sparkles className="ml-2 h-4 w-4" />
                            {artwork.aiGeneratedAt ? "إعادة اقتراح وصف للعمل" : "اقتراح وصف للعمل"}
                          </Button>
                        </div>

                        <div className="rounded-md border border-emerald-100 bg-white p-3">
                          <p className="mb-1 text-sm font-semibold text-slate-900">تحليل العمل بالوكيل الذكي</p>
                          <p className="mb-3 text-xs leading-5 text-slate-600">
                            يقدم تحليلًا تربويًا، تغذية راجعة، ومستوى أداء ونشاطًا مقترحًا.
                          </p>
                          <Button size="sm" className="w-full bg-emerald-700 text-white hover:bg-emerald-800" asChild>
                            <Link href={`/teacher/ai-art-agent?artworkId=${artwork.id}`}>
                              <Sparkles className="ml-2 h-4 w-4" />
                              تحليل بالوكيل الذكي
                            </Link>
                          </Button>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-md border border-border/70 bg-muted/20 p-3">
                      <p className="mb-2 text-xs font-semibold text-muted-foreground">خيارات النشر</p>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            setTeacherGalleryVisibility.mutate({
                              artworkId: artwork.id,
                              showInTeacherGallery: !Boolean(artwork.showInTeacherGallery),
                            })
                          }
                          disabled={setTeacherGalleryVisibility.isPending}
                        >
                          {artwork.showInTeacherGallery ? "ظاهر في معرض المعلم: إخفاء" : "مخفي من معرض المعلم: إظهار"}
                        </Button>

                        {user?.role === "admin" && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              setSiteGalleryVisibility.mutate({
                                artworkId: artwork.id,
                                showInSiteGallery: !Boolean(artwork.showInSiteGallery),
                              })
                            }
                            disabled={setSiteGalleryVisibility.isPending}
                          >
                            {artwork.showInSiteGallery ? "ظاهر في معرض الموقع: إخفاء" : "مخفي من معرض الموقع: إظهار"}
                          </Button>
                        )}
                      </div>
                    </div>

                    {user?.role === "admin" && (
                      <div className="rounded-md border border-border/70 bg-muted/20 p-3">
                        <p className="mb-2 text-xs font-semibold text-muted-foreground">التمييز والمسابقة</p>
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              updateWorkflow.mutate({
                                artworkId: artwork.id,
                                isFeatured: !Boolean(artwork.isFeatured),
                              })
                            }
                            disabled={
                              updateWorkflow.isPending ||
                              (!artwork.isFeatured && !Boolean(artwork.isPublic))
                            }
                          >
                            {artwork.isFeatured ? "إزالة التمييز" : "تمييز العمل"}
                          </Button>

                          <Select
                            value={competitionSelection[artwork.id] ?? (artwork.competitionId ? String(artwork.competitionId) : "none")}
                            onValueChange={(value) =>
                              setCompetitionSelection((prev) => ({
                                ...prev,
                                [artwork.id]: value,
                              }))
                            }
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="اختر مسابقة" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">بدون مسابقة</SelectItem>
                              {competitions.map((competition) => (
                                <SelectItem key={competition.id} value={String(competition.id)}>
                                  {competition.title}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>

                          {artwork.competitionId ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                if (!artwork.competitionId) {
                                  toast.error("العمل غير مرتبط بأي مسابقة");
                                  return;
                                }
                                removeArtworkFromCompetition.mutate({
                                  competitionId: artwork.competitionId,
                                  artworkId: artwork.id,
                                });
                              }}
                              disabled={removeArtworkFromCompetition.isPending || assignArtworkToCompetition.isPending}
                            >
                              إزالة من المسابقة
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                const selected = competitionSelection[artwork.id] ?? "none";
                                if (!selected || selected === "none") {
                                  toast.error("اختر مسابقة أولاً");
                                  return;
                                }
                                assignArtworkToCompetition.mutate({
                                  competitionId: Number(selected),
                                  artworkId: artwork.id,
                                });
                              }}
                              disabled={assignArtworkToCompetition.isPending || removeArtworkFromCompetition.isPending}
                            >
                              إضافة إلى المسابقة
                            </Button>
                          )}
                        </div>
                      </div>
                    )}

                    <div className="flex justify-end">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="sm" variant="ghost" className="text-xs">
                            <MoreHorizontal className="ml-2 h-4 w-4" />
                            المزيد من الإجراءات
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-56">
                          <DropdownMenuItem
                            onClick={() => updateWorkflow.mutate({ artworkId: artwork.id, status: "reviewed" })}
                            disabled={updateWorkflow.isPending || artwork.status === "reviewed"}
                          >
                            تعيين الحالة كمُراجَع
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={() => handleDelete(artwork.id)}
                            disabled={deleteArtwork.isPending}
                          >
                            <Trash2 className="h-4 w-4" />
                            حذف
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>

                    {artwork.challengeId && (
                      <div className="mt-2 grid grid-cols-1 gap-2">
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            className="flex-1"
                            onClick={() => handleSubmissionStatus(artwork.challengeId, artwork.id, "approved")}
                            disabled={updateSubmissionStatus.isPending}
                          >
                            اعتماد التسليم
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="flex-1"
                            onClick={() => handleSubmissionStatus(artwork.challengeId, artwork.id, "rejected")}
                            disabled={updateSubmissionStatus.isPending}
                          >
                            رفض التسليم
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                }
              />
            ))}
          </ArtworkGalleryGrid>
        )}
      </main>

      <ArtworkLightbox
        open={previewIndex !== null}
        onOpenChange={(open) => !open && setPreviewIndex(null)}
        artworks={lightboxItems}
        initialIndex={previewIndex ?? 0}
      />
    </div>
  );
}
