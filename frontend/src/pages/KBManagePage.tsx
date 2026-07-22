import { useState, useEffect, useCallback } from 'react'
import { fetchKBs, createKB, deleteKB, fetchDocuments, uploadDocument, deleteDocument } from '@/api/opencodewiki'
import type { KB, Document } from '@/types/opencodewiki'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Trash2, Upload, FileText, Plus, Database } from 'lucide-react'

export default function KBManagePage() {
  const [kbs, setKbs] = useState<KB[]>([])
  const [selectedKB, setSelectedKB] = useState<KB | null>(null)
  const [documents, setDocuments] = useState<Document[]>([])
  const [newKBName, setNewKBName] = useState('')
  const [newKBDesc, setNewKBDesc] = useState('')
  const [loading, setLoading] = useState(false)

  const loadKBs = useCallback(async () => {
    const data = await fetchKBs()
    setKbs(data)
  }, [])

  const loadDocuments = useCallback(async (kbId: string) => {
    const data = await fetchDocuments(kbId)
    setDocuments(data)
  }, [])

  useEffect(() => { loadKBs() }, [loadKBs])

  useEffect(() => {
    if (selectedKB) loadDocuments(selectedKB.id)
  }, [selectedKB, loadDocuments])

  const handleCreate = async () => {
    if (!newKBName.trim()) return
    setLoading(true)
    await createKB(newKBName, newKBDesc)
    setNewKBName('')
    setNewKBDesc('')
    await loadKBs()
    setLoading(false)
  }

  const handleDelete = async (id: string) => {
    await deleteKB(id)
    if (selectedKB?.id === id) setSelectedKB(null)
    await loadKBs()
  }

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!selectedKB || !e.target.files?.length) return
    const file = e.target.files[0]
    await uploadDocument(selectedKB.id, file)
    await loadDocuments(selectedKB.id)
    e.target.value = ''
  }

  const handleDeleteDoc = async (docId: string) => {
    if (!selectedKB) return
    await deleteDocument(selectedKB.id, docId)
    await loadDocuments(selectedKB.id)
  }

  const statusColor = (status: string) =>
    status === 'completed' ? 'text-green-600' : status === 'failed' ? 'text-red-600' : 'text-yellow-600'

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Database className="w-6 h-6" /> 知识库管理
        </h1>
        <Dialog>
          <DialogTrigger asChild>
            <Button><Plus className="w-4 h-4 mr-1" /> 新建知识库</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>新建知识库</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <Input placeholder="知识库名称" value={newKBName} onChange={e => setNewKBName(e.target.value)} />
              <Input placeholder="描述（可选）" value={newKBDesc} onChange={e => setNewKBDesc(e.target.value)} />
              <Button onClick={handleCreate} disabled={loading || !newKBName.trim()}>创建</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {kbs.map(kb => (
          <Card
            key={kb.id}
            className={`cursor-pointer transition-all ${selectedKB?.id === kb.id ? 'ring-2 ring-blue-500' : 'hover:shadow-md'}`}
            onClick={() => setSelectedKB(kb)}
          >
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-lg">{kb.name}</CardTitle>
              <Button variant="ghost" size="icon" onClick={e => { e.stopPropagation(); handleDelete(kb.id) }}>
                <Trash2 className="w-4 h-4 text-red-500" />
              </Button>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-gray-500">{kb.description || '无描述'}</p>
              <p className="text-xs text-gray-400 mt-1">模型: {kb.embedding_model}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {selectedKB && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">{selectedKB.name} — 文档列表</h2>
            <label className="cursor-pointer">
              <Button asChild><span><Upload className="w-4 h-4 mr-1" /> 上传文档</span></Button>
              <input type="file" className="hidden" accept=".md,.txt,.pdf,.docx" onChange={handleUpload} />
            </label>
          </div>
          {documents.length === 0 ? (
            <p className="text-gray-400">暂无文档，请上传。</p>
          ) : (
            <div className="space-y-2">
              {documents.map(doc => (
                <Card key={doc.id}>
                  <CardContent className="flex items-center justify-between py-3">
                    <div className="flex items-center gap-2">
                      <FileText className="w-4 h-4" />
                      <span>{doc.title}</span>
                      <span className={`text-xs ${statusColor(doc.status)}`}>({doc.status})</span>
                      {doc.status === 'completed' && <span className="text-xs text-gray-400">- {doc.chunks_count} 切片</span>}
                      {doc.error_message && <span className="text-xs text-red-500">{doc.error_message}</span>}
                    </div>
                    <Button variant="ghost" size="icon" onClick={() => handleDeleteDoc(doc.id)}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
