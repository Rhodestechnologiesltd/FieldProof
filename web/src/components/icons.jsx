// Small stroke icons (24px grid), drawn for this app.
const S = ({ children, ...p }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...p}>
    {children}
  </svg>
);

export const IconDashboard = (p) => <S {...p}><path d="M4 13h6V4H4zM14 20h6v-9h-6zM4 20h6v-3H4zM14 7h6V4h-6z" /></S>;
export const IconJobs = (p) => <S {...p}><path d="M9 5h10M9 12h10M9 19h10" /><path d="M4 5l1 1 2-2M4 12l1 1 2-2M4 19l1 1 2-2" /></S>;
export const IconCustomers = (p) => <S {...p}><path d="M4 21V8l8-5 8 5v13" /><path d="M9 21v-6h6v6" /></S>;
export const IconServices = (p) => <S {...p}><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L4 17v3h3l5.3-5.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z" /></S>;
export const IconPeople = (p) => <S {...p}><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18.5 20a6.5 6.5 0 0 0-2.5-5.1" /></S>;
export const IconMoney = (p) => <S {...p}><rect x="3" y="6" width="18" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /><path d="M6 9v.01M18 15v.01" /></S>;
export const IconLog = (p) => <S {...p}><path d="M6 3h9l4 4v14H6z" /><path d="M14 3v5h5M9 12h7M9 16h7" /></S>;
export const IconSettings = (p) => <S {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></S>;
export const IconBell = (p) => <S {...p}><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0" /></S>;
export const IconUser = (p) => <S {...p}><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></S>;
export const IconMenu = (p) => <S {...p}><path d="M4 6h16M4 12h16M4 18h16" /></S>;
export const IconToday = (p) => <S {...p}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /><path d="M9 15l2 2 4-4" /></S>;
export const IconCheck = (p) => <S strokeWidth="2.6" {...p}><path d="M5 12.5l4.5 4.5L19 7.5" /></S>;
export const IconPin = (p) => <S {...p}><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" /></S>;
export const IconFlag = (p) => <S {...p}><path d="M5 21V4M5 4h11l-2 4 2 4H5" /></S>;
export const IconX = (p) => <S strokeWidth="2.4" {...p}><path d="M6 6l12 12M18 6L6 18" /></S>;
export const IconClock = (p) => <S {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></S>;
export const IconCamera = (p) => <S {...p}><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></S>;
export const IconSend = (p) => <S {...p}><path d="M4 12l16-8-6 16-2.5-6.5z" /></S>;
export const IconPlus = (p) => <S strokeWidth="2.2" {...p}><path d="M12 5v14M5 12h14" /></S>;
export const IconUp = (p) => <S {...p}><path d="M6 15l6-6 6 6" /></S>;
export const IconDown = (p) => <S {...p}><path d="M6 9l6 6 6-6" /></S>;
export const IconTrash = (p) => <S {...p}><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /></S>;
export const IconDownload = (p) => <S {...p}><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></S>;
export const IconRoute = (p) => <S {...p}><circle cx="6" cy="19" r="2" /><circle cx="18" cy="5" r="2" /><path d="M8 19h7a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h7" /></S>;
export const IconOffline = (p) => <S {...p}><path d="M2 8.8a15 15 0 0 1 4.2-2.7M10.7 5a15 15 0 0 1 11.3 3.8M5 12.6a10 10 0 0 1 5.2-2.5M16.4 11a10 10 0 0 1 2.6 1.6M8.5 16.4a5 5 0 0 1 7 0M12 20h.01M3 3l18 18" /></S>;
export const IconStar = (p) => <S fill="currentColor" stroke="none" {...p}><path d="M12 3l2.8 5.8 6.2.9-4.5 4.4 1 6.2L12 17.4 6.5 20.3l1-6.2L3 9.7l6.2-.9z" /></S>;
export const IconCalendar = (p) => <S {...p}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></S>;
export const IconList = (p) => <S {...p}><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></S>;
