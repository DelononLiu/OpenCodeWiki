export type QaStatus = 'pending' | 'approved' | 'rejected'

export interface ParagraphCorrection {
  id: string
  paragraphIdx: number
  originalText: string
  suggestion: string
  replies: CorrectionReply[]
  createdAt: string
}

export interface CorrectionReply {
  id: string
  text: string
  author: 'user' | 'admin'
  createdAt: string
}

export interface QaFeedbackState {
  status: QaStatus
  wikiPromoted: boolean
  corrections: ParagraphCorrection[]
}

export interface FeedbackStats {
  approvedCount: number
  rejectedCount: number
  wikiPromotedCount: number
  correctionCount: number
}
