import { useState, useEffect } from 'react'
import { fetchKBs } from '@/api/opencodewiki'
import { useCodeKnoraSSE } from '@/hooks/useCodeKnoraSSE'
import ChatWindow from '@/components/ChatWindow'
import type { KB } from '@/types/opencodewiki'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Send, MessageSquare } from 'lucide-react'

export function QAPage() {
  const [kbs, setKbs] = useState<KB[]>([])
  const [selectedKB, setSelectedKB] = useState<string>('')
  const [question, setQuestion] = useState('')
  const [submittedQuestion, setSubmittedQuestion] = useState('')
  const { answer, sources, streaming, error, ask, reset } = useCodeKnoraSSE()

  useEffect(() => { fetchKBs().then(setKbs) }, [])

  const handleSubmit = async () => {
    if (!selectedKB || !question.trim()) return
    reset()
    setSubmittedQuestion(question)
    await ask(selectedKB, question)
    setQuestion('')
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    <div className="container mx-auto p-6 max-w-4xl space-y-6">
      <h1 className="text-2xl font-bold flex items-center gap-2">
        <MessageSquare className="w-6 h-6" /> 问答
      </h1>

      {/* KB selector + question input */}
      <div className="flex gap-2">
        <Select value={selectedKB} onValueChange={setSelectedKB}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="选择知识库" />
          </SelectTrigger>
          <SelectContent>
            {kbs.map(kb => (
              <SelectItem key={kb.id} value={kb.id}>{kb.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          className="flex-1"
          placeholder="输入问题..."
          value={question}
          onChange={e => setQuestion(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={streaming}
        />
        <Button onClick={handleSubmit} disabled={!selectedKB || !question.trim() || streaming}>
          <Send className="w-4 h-4" />
        </Button>
      </div>

      {/* Chat display */}
      {submittedQuestion && (
        <ChatWindow
          question={submittedQuestion}
          answer={answer}
          sources={sources}
          streaming={streaming}
          error={error}
        />
      )}

      {/* Empty state */}
      {!submittedQuestion && (
        <div className="text-center text-gray-400 py-20">
          选择一个知识库，输入问题开始问答。
        </div>
      )}
    </div>
  )
}
