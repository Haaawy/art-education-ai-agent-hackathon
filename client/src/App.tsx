import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { ArrowRightSquare } from "lucide-react";
import { Route, Switch, useLocation } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { useAuth } from "./_core/hooks/useAuth";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import AdminPanel from "./pages/Admin";
import TeacherDashboard from "./pages/teacher/Dashboard";
import TeacherClasses from "./pages/teacher/Classes";
import TeacherClassDetail from "./pages/teacher/ClassDetail";
import TeacherClassArtworks from "./pages/teacher/ClassArtworks";
import TeacherArtworks from "./pages/teacher/Artworks";
import TeacherChallenges from "./pages/teacher/Challenges";
import TeacherAttendance from "./pages/teacher/Attendance";
import TeacherLessons from "./pages/teacher/Lessons";
import TeacherReports from "./pages/teacher/Reports";
import TeacherLessonsManagement from "./pages/teacher/LessonsManagement";
import TeacherLessonPresentationView from "./pages/teacher/LessonPresentationView";
import TeacherVideoLibrary from "./pages/teacher/VideoLibrary";
import TeacherProfile from "./pages/teacher/TeacherProfile";
import TeacherStatistics from "./pages/teacher/Statistics";
import TeacherLearningPaths from "./pages/teacher/LearningPaths";
import TeacherLearningPathDetail from "./pages/teacher/LearningPathDetail";
import TeacherCertificatesManagement from "./pages/teacher/CertificatesManagement";
import TeacherGrades from "./pages/teacher/Grades";
import TeacherGradeSettings from "./pages/teacher/GradeSettings";
import TeacherGiftedStudents from "./pages/teacher/GiftedStudents";
import TeacherBadgesAssignmentPage from "./pages/teacher/BadgesAssignment";
import TeacherAiArtAgent from "./pages/teacher/AiArtAgent";
import TeacherOwnGalleryPage from "./pages/teacher/Gallery";
import TeacherGallerySettingsPage from "./pages/teacher/GallerySettings";
import TeacherClassGalleryPage from "./pages/teacher/ClassGallery";
import TeacherClassGallerySettingsPage from "./pages/teacher/ClassGallerySettings";
import CompetitionsManagementPage from "./pages/teacher/CompetitionsManagement";
import TeacherCompetitionsPage from "./pages/teacher/TeacherCompetitions";
import BadgesManagementPage from "./pages/admin/BadgesManagement";
import AdminGallerySettingsPage from "./pages/admin/GallerySettings";
import AdminQuizManagementPage from "./pages/admin/QuizManagement";
import VideoImportManagementPage from "./pages/admin/VideoImportManagement";
import StudentDashboard from "./pages/student/Dashboard";
import StudentDraw from "./pages/student/Draw";
import StudentArtworks from "./pages/student/Artworks";
import StudentChallenges from "./pages/student/Challenges";
import StudentLessons from "./pages/student/Lessons";
import StudentLessonDetail from "./pages/student/LessonDetail";
import StudentLearningPaths from "./pages/student/LearningPaths";
import StudentLearningPathDetail from "./pages/student/LearningPathDetail";
import StudentGallery from "./pages/student/Gallery";
import StudentAchievements from "./pages/student/Achievements";
import StudentArtistProfilePage from "./pages/student/ArtistProfile";
import StudentQuiz from "./pages/student/Quiz";
import StudentCertificates from "./pages/student/Certificates";
import StudentCertificatePreviewPage from "./pages/student/CertificatePreview";
import Gallery from "./pages/Gallery";
import TeacherGallery from "./pages/gallery/TeacherGallery";
import PublicClassGalleryPage from "./pages/gallery/ClassGallery";
import PublicStudentGalleryPage from "./pages/gallery/StudentGallery";
import CompetitionGalleryPage from "./pages/gallery/CompetitionGallery";
import CompetitionsPage from "./pages/competitions/Competitions";
import CompetitionDetailsPage from "./pages/competitions/CompetitionDetails";
import JoinClass from "./pages/JoinClass";
import SelectRole from "./pages/SelectRole";
import SupportRequest from "./pages/SupportRequest";
import About from "./pages/About";
import Privacy from "./pages/Privacy";
import Terms from "./pages/Terms";
import LoginPage from "./pages/Login";
import TeacherRegisterPage from "./pages/TeacherRegister";
import ExecutiveShowcase from "./pages/ExecutiveShowcase";

function Router() {
  return (
    <Switch>
      <Route path={"/"} component={Home} />
      <Route path={"/about"} component={About} />
      <Route path={"/privacy"} component={Privacy} />
      <Route path={"/terms"} component={Terms} />
      <Route path={"/login"} component={LoginPage} />
      <Route path={"/teacher-register"} component={TeacherRegisterPage} />
      <Route path={"/select-role"} component={SelectRole} />
      <Route path={"/admin"} component={AdminPanel} />
      <Route path={"/admin/badges"} component={BadgesManagementPage} />
      <Route path={"/admin/gallery-settings"} component={AdminGallerySettingsPage} />
      <Route path={"/admin/quizzes"} component={AdminQuizManagementPage} />
      <Route path={"/admin/video-import"} component={VideoImportManagementPage} />
      <Route path={"/executive-showcase"} component={ExecutiveShowcase} />
      <Route path={"/404"} component={NotFound} />
      <Route path="/teacher" component={TeacherDashboard} />
      <Route path="/teacher/dashboard" component={TeacherDashboard} />
      <Route path="/teacher/classes" component={TeacherClasses} />
      <Route path="/teacher/class/:id/artworks" component={TeacherClassArtworks} />
      <Route path="/teacher/class/:id/gallery" component={TeacherClassGalleryPage} />
      <Route path="/teacher/class/:id/gallery/settings" component={TeacherClassGallerySettingsPage} />
      <Route path="/teacher/class/:id" component={TeacherClassDetail} />
      <Route path="/teacher/artworks" component={TeacherArtworks} />
      <Route path="/teacher/gallery" component={TeacherOwnGalleryPage} />
      <Route path="/teacher/gallery/settings" component={TeacherGallerySettingsPage} />
      <Route path="/teacher/competitions" component={TeacherCompetitionsPage} />
      <Route path="/teacher/challenges" component={TeacherChallenges} />
      <Route path="/teacher/attendance" component={TeacherAttendance} />
      <Route path="/teacher/lessons" component={TeacherLessons} />
      <Route path="/teacher/lessons-management" component={TeacherLessonsManagement} />
      <Route path="/teacher/lessons-management/:id/view" component={TeacherLessonPresentationView} />
      <Route path="/teacher/video-library" component={TeacherVideoLibrary} />
      <Route path="/teacher/reports" component={TeacherReports} />
      <Route path="/teacher/profile" component={TeacherProfile} />
      <Route path="/teacher/statistics" component={TeacherStatistics} />
      <Route path="/teacher/grades" component={TeacherGrades} />
      <Route path="/teacher/grade-settings" component={TeacherGradeSettings} />
      <Route path="/teacher/gifted-students" component={TeacherGiftedStudents} />
      <Route path="/teacher/badges" component={TeacherBadgesAssignmentPage} />
      <Route path="/teacher/ai-art-agent" component={TeacherAiArtAgent} />
      <Route path="/teacher/competitions-management" component={CompetitionsManagementPage} />
      <Route path="/teacher/learning-paths" component={TeacherLearningPaths} />
      <Route path="/teacher/learning-path/:id" component={TeacherLearningPathDetail} />
      <Route path="/teacher/certificates-management" component={TeacherCertificatesManagement} />
      <Route path="/student/dashboard" component={StudentDashboard} />
      <Route path="/student/draw" component={StudentDraw} />
      <Route path="/student/artworks" component={StudentArtworks} />
      <Route path="/student/artworks/:id" component={StudentArtworks} />
      <Route path="/student/challenges" component={StudentChallenges} />
      <Route path="/student/lessons" component={StudentLessons} />
      <Route path="/student/quiz" component={StudentLessons} />
      <Route path="/student/lesson/:id" component={StudentLessonDetail} />
      <Route path="/student/quiz/:lessonId" component={StudentQuiz} />
      <Route path="/student/learning-paths" component={StudentLearningPaths} />
      <Route path="/student/learning-path/:id" component={StudentLearningPathDetail} />
      <Route path="/student/gallery" component={StudentGallery} />
      <Route path="/student/achievements" component={StudentAchievements} />
      <Route path="/artist/:studentId" component={StudentArtistProfilePage} />
      <Route path="/student/certificates/:certificateId/preview" component={StudentCertificatePreviewPage} />
      <Route path="/student/certificates" component={StudentCertificates} />
      <Route path="/support-request" component={SupportRequest} />
      <Route path="/gallery" component={Gallery} />
      <Route path="/gallery/teacher/:teacherSlug" component={TeacherGallery} />
      <Route path="/gallery/competition/:id" component={CompetitionGalleryPage} />
      <Route path="/competition/:id" component={CompetitionGalleryPage} />
      <Route path="/gallery/class/:shareSlug" component={PublicClassGalleryPage} />
      <Route path="/gallery/student/:shareSlug" component={PublicStudentGalleryPage} />
      <Route path="/competitions" component={CompetitionsPage} />
      <Route path="/competitions/:competitionId" component={CompetitionDetailsPage} />
      <Route path="/join/:classCode" component={JoinClass} />
      <Route path={"/404"} component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function AdminTeacherReturnButton() {
  const { user, loading } = useAuth();
  const [location] = useLocation();

  if (loading || !user || user.role !== "admin") return null;
  if (!location.startsWith("/teacher")) return null;
  if (/^\/teacher\/lessons-management\/[^/]+\/view\/?$/.test(location)) return null;

  return (
    <div className="fixed bottom-4 left-4 z-50">
      <Button asChild size="sm" className="shadow-lg">
        <a href="/admin">
          <ArrowRightSquare className="h-4 w-4 ml-1" />
          الرجوع إلى لوحة المدير
        </a>
      </Button>
    </div>
  );
}

// NOTE: About Theme
// - First choose a default theme according to your design style (dark or light bg), than change color palette in index.css
//   to keep consistent foreground/background color across components
// - If you want to make theme switchable, pass `switchable` ThemeProvider and use `useTheme` hook

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider
        defaultTheme="light"
        // switchable
      >
        <TooltipProvider>
          <Toaster />
          <AdminTeacherReturnButton />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
