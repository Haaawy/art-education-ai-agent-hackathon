# Architecture - Art Education AI Agent

This diagram summarizes the current hackathon architecture. The Microsoft Copilot Agent Builder version is linked from the platform but does not call the backend directly in the current release.

```mermaid
flowchart LR
  Teacher[Teacher]
  Platform[Arts Web Platform]
  Dashboard[Teacher Dashboard]
  AgentPage[AI Art Agent Page]
  Api[Server API: teacher.aiArtAgent]
  Service[artAiAgent Service]
  Provider[AI Provider]
  Fallback[Fallback Preview Mode]
  Copilot[Microsoft 365 Copilot Agent Builder]
  WorkIQ[Microsoft Work IQ]
  Privacy[Privacy Page /privacy]
  Terms[Terms Page /terms]

  Teacher --> Platform
  Platform --> Dashboard
  Platform --> AgentPage
  Platform --> Privacy
  Platform --> Terms

  Dashboard -->|Open platform agent| AgentPage
  Dashboard -->|Open external Copilot link| Copilot
  AgentPage -->|Analyze artwork| Api
  AgentPage -->|Open external Copilot link| Copilot
  Copilot -->|Microsoft IQ layer| WorkIQ

  Api --> Service
  Service -->|Configured and successful| Provider
  Service -->|Not configured or provider error| Fallback

  Provider --> Service
  Fallback --> Service
  Service --> Api
  Api --> AgentPage

  WorkIQ -. Microsoft 365 work context layer .-> Copilot
  Copilot -. Current version uses teacher-entered prompts .-> Teacher
```

## Components

- **Teacher**: uses the platform to review student artworks and request feedback.
- **Arts Web Platform**: React/Vite frontend that hosts the teacher workflow.
- **AI Art Agent Page**: `/teacher/ai-art-agent`, the main in-platform agent experience.
- **Server API / teacher.aiArtAgent**: protected tRPC router used by the teacher page.
- **artAiAgent Service**: server service that builds prompts, normalizes results, and returns preview fallback responses when needed.
- **AI Provider / Fallback Preview Mode**: real provider path when configured and successful; structured Arabic preview mode otherwise.
- **Microsoft 365 Copilot Agent Builder**: parallel external agent experience opened through a link.
- **Microsoft Work IQ**: the Microsoft IQ layer used by the Copilot Agent Builder path for the Agents League submission.
- **Privacy and Terms Pages**: public pages used for transparency and hackathon readiness.
