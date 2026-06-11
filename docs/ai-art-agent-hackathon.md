# Art Education AI Agent - Agents League

## Project Name

Art Education AI Agent for Student Artwork Analysis.

## Problem

Art education teachers spend significant time reviewing student artwork and writing individualized feedback. The work becomes harder when a teacher manages many classes and submissions. Feedback can become too generic, delayed, or difficult to reuse in a structured learning workflow.

## Solution

The Art Education AI Agent provides a teacher-facing page inside the arts platform. A teacher can select a student artwork and generate a structured educational analysis that includes:

- Artwork summary.
- Visible agent analysis steps.
- Strengths.
- Improvement areas.
- Performance level.
- Ready-to-use student feedback.
- Suggested remediation or enrichment activity.
- Short teacher notes.

## How The Agent Works

1. Reads artwork context such as title, description, student name, class, and teacher notes.
2. Analyzes the artistic idea and elements such as composition, color, line, space, material, and expression.
3. Connects observations to relevant art education skills.
4. Selects one performance level: Needs support, Improving, Proficient, or Advanced.
5. Generates educational feedback that the teacher can review before sharing.
6. Suggests a remediation or enrichment activity for the teacher.

## Technologies Used

- React and Vite for the teacher interface.
- TypeScript for type safety.
- tRPC for client/server integration.
- Drizzle and MySQL for storing analysis records.
- The existing project LLM service through `server/_core/llm.ts`.
- Structured fallback mode when an AI provider key is not configured.

## Run Steps

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

Enable the feature:

```env
AI_ART_AGENT_ENABLED=true
```

Configure an AI provider key when available:

```env
BUILT_IN_FORGE_API_KEY=...
```

Do not commit real keys or secrets to the repository.

## Page Route

```text
/teacher/ai-art-agent
```

The agent can also open with a selected artwork:

```text
/teacher/ai-art-agent?artworkId=ARTWORK_ID
```

## Hackathon Notes

- The page includes a demo mode when no artwork is available, so the demo can run without real student data.
- The agent displays analysis steps visually to make agent behavior clear.
- The feature is behind a feature flag and does not change the permission model.
- When no AI key is configured, the page returns a structured fallback response instead of exposing an error.

## Microsoft Copilot Agent Builder Version

Suggested agent name: Art Education AI Agent.

The Microsoft Copilot Agent Builder version mirrors the in-platform agent. It helps an art education teacher analyze artwork based on details or notes typed into Copilot. It does not directly connect to the platform backend in the current release.

### Suggested System Instructions

You are an educational assistant specialized in art education. Your task is to help art teachers analyze student artworks in a constructive, practical, and privacy-aware way. When the teacher provides artwork details or observations:

1. Read the artwork context and available student/class context.
2. Analyze artistic elements such as composition, color, line, space, material, and expression.
3. Connect the observations to suitable art education skills.
4. Choose a performance level from: Needs support, Improving, Proficient, Advanced.
5. Write ready-to-use student feedback in a clear and encouraging tone.
6. Suggest a remediation or enrichment activity for the teacher.

Respect privacy. Do not ask for sensitive personal student data. Do not compare students to each other. If the provided context is incomplete, state the limits of the analysis and suggest what the teacher could add.

### Response Format

Use this structure:

- Artwork summary.
- How the agent reached the result.
- Strengths.
- Improvement areas.
- Performance level.
- Ready-to-use student feedback.
- Suggested remediation or enrichment activity.
- Short student message.
- Teacher notes.

### Example Teacher Prompts

- Analyze a student artwork titled "My Colorful Garden" and write suitable feedback.
- This artwork uses cool colors and repeated lines. What performance level fits it?
- Suggest a remediation activity for a student who needs to improve composition.
- Write a short encouraging message for a student who drew a simple landscape.
- Convert these teacher notes into ready-to-use student feedback.

### Current Limitations

- There is no direct API integration between Copilot and the platform in this release.
- Copilot does not automatically read arts platform data.
- The Copilot agent depends on context typed by the teacher.
- The platform displays a direct link to the Microsoft Copilot Agent from the agent page and teacher dashboard.
- Teachers should avoid entering sensitive personal student data.
- Agent output is an educational draft and should be reviewed by the teacher before use.

### Future Integration Plan

A future version can connect Copilot Agent Builder to the platform through secure Actions or APIs so the agent can:

- Fetch artworks available to the teacher according to permissions.
- Send an analysis request to a platform endpoint.
- Store the result in `ai_artwork_analyses`.
- Open the artwork or agent page from Copilot.
- Preserve the existing permission model without exposing student data or server secrets.

## Microsoft Copilot Agent Link

```text
https://m365.cloud.microsoft/chat/?titleId=T_40a80c99-7f9e-5c95-5bf4-6f4068fc23b0&source=embedded-builder
```

This link may require Microsoft 365 Copilot access inside the organization. The final demo can also use a video walkthrough so reviewers can evaluate the solution if external access is limited.

## Microsoft IQ Requirement

- Agents League requires at least one Microsoft IQ layer.
- This project uses Work IQ through the Microsoft 365 Copilot Agent Builder version.
- The submission demonstrates two complementary experiences: an in-platform agent and a parallel Microsoft 365 Copilot agent.
- The current Copilot version uses teacher-provided artwork context and does not directly call the platform backend.