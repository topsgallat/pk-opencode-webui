import { render } from "solid-js/web"
import { QuestionPrompt } from "../src/components/question-prompt"
import "../src/index.css"

const filler = Array.from({ length: 24 }, (_, i) => `Line ${i + 1}: this is intentionally long content to force vertical scrolling inside the question prompt.`).join("\n\n")

const request = {
  id: "qa-question",
  sessionID: "qa-session",
  questions: [
    {
      header: "Scope",
      question: `Please review this long question before answering.\n\n${filler}`,
      multiple: true,
      options: [
        { label: "Alpha", description: "First option" },
        { label: "Beta", description: "Second option" },
        { label: "Gamma", description: "Third option" },
        { label: "Delta", description: "Fourth option" },
      ],
    },
    {
      header: "Mode",
      question: "Pick one mode.",
      options: [
        { label: "Safe", description: "Safe mode" },
        { label: "Fast", description: "Fast mode" },
      ],
    },
  ],
}

function App() {
  return (
    <div style={{ height: "200vh", background: "var(--background-stronger)", color: "var(--text-base)" }}>
      <div style={{ height: "28rem" }} />
      <div style={{ padding: "1rem" }}>
        <div style={{ "max-width": "26rem" }}>
          <QuestionPrompt request={request} onReply={(answers) => ((window as any).__qaReply = answers)} onReject={() => ((window as any).__qaReject = true)} />
        </div>
      </div>
      <div style={{ height: "60rem" }} />
    </div>
  )
}

const root = document.getElementById("root")
if (!root) throw new Error("Root element not found")
render(() => <App />, root)
