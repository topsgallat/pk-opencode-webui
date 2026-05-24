import { render } from "solid-js/web"
import { PickerDialog } from "../src/components/picker-dialog"
import "../src/index.css"

const items = [
  { id: "p1:m1", title: "Model A", description: "provider-a/model-a", group: "Provider A" },
  { id: "p1:m2", title: "Model B", description: "provider-a/model-b", group: "Provider A" },
  { id: "p2:m1", title: "Model C", description: "provider-b/model-c", group: "Provider B" },
  { id: "p2:m2", title: "Model D", description: "provider-b/model-d", group: "Provider B" },
]

function App() {
  return (
    <PickerDialog
      title="Select Model"
      placeholder="Filter models..."
      items={items}
      onSelect={() => {}}
      onClose={() => {}}
    />
  )
}

const root = document.getElementById("root")
if (!root) throw new Error("Root element not found")
render(() => <App />, root)
