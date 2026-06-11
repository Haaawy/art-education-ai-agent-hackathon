# Art Education AI Agent

This repository is a public hackathon/submission copy focused on the **Art Education AI Agent** feature. It is not a full production dump of the private arts platform and does not include confidential data, environment files, database dumps, private student images, or real secrets.

## Hackathon Submission

- Track: Enterprise Agents
- Microsoft IQ Layer: Work IQ
- Microsoft integration: Microsoft 365 Copilot Agent Builder
- Demo platform link: `/teacher/ai-art-agent`
- Copilot Agent link: `https://m365.cloud.microsoft/chat/?titleId=T_40a80c99-7f9e-5c95-5bf4-6f4068fc23b0&source=embedded-builder`
- Privacy link: `/privacy`
- Terms link: `/terms`
- Confidential data: not included
Project name: Art Education AI Agent

Arabic name: Art Education Teacher Agent for Student Artwork Analysis

## Problem

Art education teachers spend significant time reviewing student artworks and writing meaningful feedback. The process becomes harder when one teacher manages many classes, students, and submitted artworks. Feedback can become too general, delayed, or difficult to reuse in a structured educational workflow.

## Solution

The project adds an AI art education agent inside the arts platform. A teacher can select a student artwork, run an educational analysis, and receive a structured Arabic report that includes strengths, improvement areas, performance level, ready feedback, a suggested enrichment or remediation activity, and notes for the teacher.

The hackathon version also includes a parallel Microsoft Copilot Agent Builder version that follows the same educational idea without direct API integration.

## Key Features

- Teacher-facing page: `/teacher/ai-art-agent`
- Artwork selection from the teacher workflow
- Structured Arabic analysis for student artworks
- Analysis steps that make the agent behavior visible
- Performance levels: Needs support, Improving, Proficient, Advanced
- Copy buttons for feedback, student message, and full report
- Preview fallback mode when an AI provider is not configured
- Microsoft Copilot Agent link inside the platform
- Public privacy and terms pages: `/privacy` and `/terms`
- Documentation for Copilot Agent Builder setup and hackathon submission

## Microsoft Technologies Used

- Microsoft 365 Copilot Agent Builder for the parallel Copilot agent experience
- Microsoft Copilot as the presentation path for the external agent version
- Microsoft Work IQ through the Microsoft 365 Copilot experience, used as the required Microsoft IQ layer for the Agents League submission
- Future-ready plan for Microsoft Copilot Actions or API-based integration

## Microsoft IQ Requirement

Agents League submissions require at least one Microsoft IQ intelligence layer. This project uses **Work IQ** through the Microsoft 365 Copilot Agent Builder version of the art education agent. The in-platform agent remains available inside arts, while the Copilot version demonstrates how the same educational workflow can run in the Microsoft 365 Copilot environment.

The current release does not connect Copilot to the platform backend through an API. Teachers provide the artwork context directly in Copilot, and the platform provides a clear link to the Copilot agent for the hackathon demo.

## Demo Links

- Internal platform agent: `/teacher/ai-art-agent`
- Privacy page: `/privacy`
- Terms page: `/terms`
- Microsoft Copilot Agent:

```text
https://m365.cloud.microsoft/chat/?titleId=T_40a80c99-7f9e-5c95-5bf4-6f4068fc23b0&source=embedded-builder
```

The Copilot link may require Microsoft 365 Copilot access within the organization. The final demo can also use a video walkthrough to ensure reviewers can evaluate the solution if external access is limited.

## Setup Instructions

```bash
pnpm install
pnpm check
pnpm build
pnpm dev
```

Then open:

```text
/teacher/ai-art-agent
```

## Environment Variables

Use environment variables only through the deployment or local `.env` configuration. Do not commit secrets.

```env
AI_ART_AGENT_ENABLED=true
BUILT_IN_FORGE_API_KEY=
```

- `AI_ART_AGENT_ENABLED=true` enables the feature.
- `BUILT_IN_FORGE_API_KEY` configures the AI provider when available.
- If the provider key is not configured, the platform uses a structured Arabic preview response instead of failing.

## Privacy Note

The agent is designed for educational feedback. Teachers should avoid entering sensitive personal student data. The analysis may use artwork data such as title, description, image link, and teacher notes. Provider keys are not displayed or shared with users. Access to student artworks follows the existing platform permissions.

## AI Tools Used During Development

- Codex was used to assist with implementation, documentation, checks, and build verification.
- The platform AI provider path is handled through the existing server LLM service.
- Microsoft Copilot Agent Builder was used to prepare the parallel Copilot agent version for the hackathon.
