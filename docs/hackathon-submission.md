# Hackathon Submission - Art Education AI Agent

## Project Title

Art Education AI Agent - وكيل معلم التربية الفنية لتحليل أعمال الطلاب

## Short Description

An Arabic AI agent for art education teachers that analyzes student artworks, generates structured educational feedback, suggests performance levels and activities, and includes a parallel Microsoft Copilot Agent Builder version for the hackathon demo.

## Full Project Description

The arts platform helps art education teachers manage classes, student artworks, galleries, learning activities, and feedback. This hackathon feature adds an AI agent focused on a specific teacher workflow: reviewing student artwork and writing meaningful feedback.

The teacher can open the AI Art Agent page inside the platform, choose a student artwork, and request an analysis. The result is presented as an organized Arabic report with analysis steps, artwork summary, strengths, improvement areas, performance level, ready-to-send student feedback, a suggested remediation or enrichment activity, a short student message, and teacher notes.

The project also includes a Microsoft 365 Copilot Agent Builder version that mirrors the same idea. It allows a teacher to use the agent inside Microsoft 365 by typing artwork details or notes. This version is linked from the platform but does not directly call platform APIs in the current stage.

## Problem Statement

Art teachers often review many student artworks across several classes. Writing individualized, pedagogically useful feedback takes time and can become inconsistent. Teachers need a faster way to transform artwork details and observations into structured feedback while keeping final judgment under teacher control.

## Solution Overview

The solution provides two complementary experiences:

- An in-platform AI agent inside arts for teachers who want to analyze artworks already available in the platform.
- A Microsoft Copilot Agent Builder version for teachers who want to use the same educational workflow inside Microsoft 365.

The in-platform agent supports preview fallback mode when no AI provider is configured, so the page remains usable for development and demo purposes without exposing errors or secrets.

## Target Users

- Art education teachers
- School art supervisors
- Students receiving feedback through their teacher
- Hackathon reviewers evaluating agent behavior and educational value

## Microsoft Technology Used

- Microsoft 365 Copilot Agent Builder for the parallel Copilot agent.
- Microsoft Copilot as the external agent experience for the demo.
- Microsoft Work IQ through Microsoft 365 Copilot, used as the required Microsoft IQ intelligence layer for Agents League.
- A documented future path for Copilot Actions or API integration with the arts platform.

## Microsoft IQ Layer

The submission uses **Work IQ** through the Microsoft 365 Copilot Agent Builder version of the agent. This version lets the teacher use the same art education feedback workflow inside the Microsoft 365 Copilot environment by entering artwork context, class notes, or assessment observations directly in the conversation.

The current implementation intentionally avoids direct backend integration with Copilot. No platform secrets, API keys, or student data are shared automatically with Microsoft Copilot. Future work can add secure Copilot Actions or API integration while preserving the existing platform permission model.

## How the Agent Works

1. Reads artwork data such as title, description, student name, class, and teacher notes.
2. Analyzes the artistic idea and elements such as composition, color, line, space, material, and expression.
3. Connects observations to art education skills.
4. Selects a performance level: يحتاج دعمًا، في طور التحسن، متمكن، متقدم.
5. Generates ready-to-use Arabic feedback for the student.
6. Suggests a remediation or enrichment activity for the teacher.
7. Shows analysis steps so the teacher can understand the agent workflow.

## Demo Video Script Summary

1. Open the arts platform and show the teacher dashboard.
2. Show the Microsoft Copilot Agent card inside the dashboard.
3. Open the AI Art Agent page inside the platform.
4. Select a student artwork or use demo mode if no artwork exists.
5. Run the analysis and show the loading state.
6. Review the structured result cards.
7. Copy the student feedback and full report.
8. Open the Microsoft Copilot Agent link in a new tab.
9. Test a sample prompt in Copilot Agent Builder.
10. Show the privacy and terms pages.

## GitHub Repo Note

The GitHub repository contains the arts platform code, the in-platform AI agent implementation, Microsoft Copilot Agent Builder documentation, public privacy and terms pages, and hackathon submission materials.

## Copilot Agent Link Note

Microsoft Copilot Agent link:

```text
https://m365.cloud.microsoft/chat/?titleId=T_40a80c99-7f9e-5c95-5bf4-6f4068fc23b0&source=embedded-builder
```

This link may require Microsoft 365 Copilot access inside the organization. The final submission should include a demo video so the solution remains reviewable even if external access is restricted.

## Privacy and Safety Notes

- Do not enter sensitive personal student data into the agent.
- The teacher remains responsible for reviewing and approving AI-generated feedback.
- Provider keys and secrets are never included in documentation or exposed to users.
- Access to student artworks follows the platform's existing permission model.
- The Copilot Agent Builder version does not directly read platform data in the current release.
