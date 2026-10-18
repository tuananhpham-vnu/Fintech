import type { Locale } from '@/lib/api/contracts'
const words = {
  invite: ['Create scoped invitation', 'Tạo lời mời có phạm vi', '创建限定邀请'],
  close: ['Close questionnaire', 'Đóng bộ câu hỏi', '关闭问卷'],
  revoke: ['Revoke', 'Thu hồi', '撤销'],
  answerChoice: ['Answer', 'Trả lời', '回答'],
  active: ['Active invitation', 'Lời mời còn hiệu lực', '邀请有效'],
  expires: ['Expires', 'Hết hạn', '到期时间'],
  recipient: [
    'Recipient reference (self-reported)',
    'Thông tin người nhận (tự khai)',
    '收件人参考（自报）',
  ],
  limitation: [
    'This invitation grants question access only. It does not verify legal identity. Share the link manually.',
    'Lời mời chỉ cấp quyền trả lời, không xác nhận pháp nhân. Chủ động gửi liên kết cho đúng người nhận.',
    '邀请仅授予答题权限，不验证法律身份。请向指定收件人发送链接。',
  ],
  link: [
    'Private link: copy before closing and share only with the invited recipient.',
    'Liên kết riêng chỉ có trong phiên này. Sao chép trước khi đóng và chỉ gửi cho người được mời.',
    '此私密链接仅在本次会话可用，请在关闭前复制并仅发送给受邀人。',
  ],
  lost: [
    'This invitation was already created and its link cannot be shown again. Revoke and create a new invitation if needed.',
    'Lời mời đã được tạo trước đó và không thể hiển thị lại liên kết. Thu hồi rồi tạo lời mời mới nếu cần.',
    '此邀请已创建，无法再次显示链接。必要时撤销并创建新邀请。',
  ],
  identity: [
    'Your name/contact reference (self-reported)',
    'Tên/thông tin liên hệ của bạn (tự khai)',
    '您的姓名或联系方式（自报）',
  ],
  skip: ['Reason for skipping', 'Lý do bỏ qua', '跳过原因'],
  receipt: ['Submission receipt', 'Biên nhận trả lời', '提交回执'],
  unavailable: [
    'Invitation expired, revoked or unavailable. Ask the specialist for a new scoped invitation.',
    'Lời mời hết hạn, đã thu hồi hoặc không khả dụng. Liên hệ chuyên viên để nhận lời mời mới.',
    '邀请已过期、撤销或不可用，请联系专员。',
  ],
} as const
export function nativeCopy(locale: Locale) {
  return (key: keyof typeof words) => words[key][locale === 'en' ? 0 : locale === 'vi' ? 1 : 2]
}
