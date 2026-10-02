/**
 * Visitor chat widget translations.
 *
 * Lightweight i18n for the public chat interface — not full UI i18n.
 * Each locale has the same keys for chat-specific strings.
 */

export interface ChatStrings {
  welcome: string;
  placeholder: string;
  sendLabel: string;
  openLabel: string;
  minimizeLabel: string;
  headerTitle: string;
  languageLabel: string;
  errorGeneric: string;
  errorRateLimit: string;
}

export const SUPPORTED_LOCALES = ['en', 'es', 'fr', 'zh', 'ja', 'de'] as const;
export type SupportedLocale = typeof SUPPORTED_LOCALES[number];

export const LOCALE_LABELS: Record<SupportedLocale, string> = {
  en: 'English',
  es: 'Español',
  fr: 'Français',
  zh: '中文',
  ja: '日本語',
  de: 'Deutsch',
};

const strings: Record<SupportedLocale, ChatStrings> = {
  en: {
    welcome: "Hi! I'm Madrona, your gallery guide. Ask me about the collection or what's on view.",
    placeholder: 'Ask about the collection...',
    sendLabel: 'Send message',
    openLabel: 'Open gallery guide',
    minimizeLabel: 'Minimize chat',
    headerTitle: 'Madrona',
    languageLabel: 'Language',
    errorGeneric: 'Something went wrong. Please try again.',
    errorRateLimit: 'Too many messages. Please wait a moment.',
  },
  es: {
    welcome: '¡Hola! Soy Madrona, tu guía de la galería. Pregúntame sobre la colección o las exposiciones.',
    placeholder: 'Pregunta sobre la colección...',
    sendLabel: 'Enviar mensaje',
    openLabel: 'Abrir guía de galería',
    minimizeLabel: 'Minimizar chat',
    headerTitle: 'Madrona',
    languageLabel: 'Idioma',
    errorGeneric: 'Algo salió mal. Por favor, inténtalo de nuevo.',
    errorRateLimit: 'Demasiados mensajes. Por favor, espera un momento.',
  },
  fr: {
    welcome: 'Bonjour ! Je suis Madrona, votre guide de galerie. Posez-moi vos questions sur la collection.',
    placeholder: 'Posez une question sur la collection...',
    sendLabel: 'Envoyer le message',
    openLabel: 'Ouvrir le guide',
    minimizeLabel: 'Réduire le chat',
    headerTitle: 'Madrona',
    languageLabel: 'Langue',
    errorGeneric: "Quelque chose s'est mal passé. Veuillez réessayer.",
    errorRateLimit: 'Trop de messages. Veuillez patienter.',
  },
  zh: {
    welcome: '你好！我是 Madrona，你的画廊向导。问我关于藏品或展览的问题吧。',
    placeholder: '询问关于藏品的问题...',
    sendLabel: '发送消息',
    openLabel: '打开画廊向导',
    minimizeLabel: '最小化聊天',
    headerTitle: 'Madrona',
    languageLabel: '语言',
    errorGeneric: '出了点问题，请重试。',
    errorRateLimit: '消息过多，请稍候。',
  },
  ja: {
    welcome: 'こんにちは！マドロナです。コレクションや展示についてお気軽にお尋ねください。',
    placeholder: 'コレクションについて質問...',
    sendLabel: 'メッセージを送信',
    openLabel: 'ギャラリーガイドを開く',
    minimizeLabel: 'チャットを最小化',
    headerTitle: 'Madrona',
    languageLabel: '言語',
    errorGeneric: '問題が発生しました。もう一度お試しください。',
    errorRateLimit: 'メッセージが多すぎます。少々お待ちください。',
  },
  de: {
    welcome: 'Hallo! Ich bin Madrona, Ihr Galerieführer. Fragen Sie mich zur Sammlung oder zu aktuellen Ausstellungen.',
    placeholder: 'Fragen Sie zur Sammlung...',
    sendLabel: 'Nachricht senden',
    openLabel: 'Galerieführer öffnen',
    minimizeLabel: 'Chat minimieren',
    headerTitle: 'Madrona',
    languageLabel: 'Sprache',
    errorGeneric: 'Etwas ist schiefgelaufen. Bitte versuchen Sie es erneut.',
    errorRateLimit: 'Zu viele Nachrichten. Bitte warten Sie einen Moment.',
  },
};

export function getChatStrings(locale: string): ChatStrings {
  const key = (SUPPORTED_LOCALES as readonly string[]).includes(locale)
    ? (locale as SupportedLocale)
    : 'en';
  return strings[key];
}
