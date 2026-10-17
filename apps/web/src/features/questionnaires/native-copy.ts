import type { Locale } from '@/lib/api/contracts'
const words = {
  invite: ['Create scoped invitation', 'Tạo lời mời có phạm vi', '创建限定邀请'],
  close: ['Close questionnaire', 'Đóng bộ câu hỏi', '关闭问卷'],
  revoke: ['Revoke', 'Thu hồi', '撤销'],
  recipient: [
    'Recipient reference (self-reported)',
    'Thông tin người nhận (tự khai)',
    '收件人参考（自报）',
  ],
  limitation: [
    'This token grants question access only. It does not verify legal identity. Share the link manually.',
    'Token chỉ cấp quyền trả lời, không xác nhận pháp nhân. Chia sẻ link thủ công.',
    '令牌仅授予答题权限，不验证法律身份。请手动分享链接。',
  ],
  link: [
    'One-time link: copy before closing. It is not saved by the server.',
    'Link chỉ hiện lần này: sao chép trước khi đóng. Server không lưu raw token.',
    '链接仅显示一次，关闭前请复制。服务器不保存原始令牌。',
  ],
  lost: [
    'The operation was replayed; the secret cannot be returned again. Revoke and explicitly reissue if needed.',
    'Thao tác đã replay; không thể trả lại token. Thu hồi và tạo lời mời mới rõ ràng nếu cần.',
    '操作已重放，无法再次返回密钥。必要时撤销并明确重新签发。',
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
