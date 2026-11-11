// Server-side text for emails and push notifications, in the four supported languages.
// The web app renders in-app notifications from its own translation files using the same type keys.
// Kreol Morisien (mfe) and Arabic (ar) text should be reviewed by a native speaker before launch.

const t = {
  job_assigned_supervisor: {
    en: (p) => `New job for your team: ${p.job} at ${p.site}, ${p.when}`,
    fr: (p) => `Nouvelle mission pour votre équipe : ${p.job} à ${p.site}, ${p.when}`,
    mfe: (p) => `Nouvo travay pou ou lekip: ${p.job} kot ${p.site}, ${p.when}`,
    ar: (p) => `مهمة جديدة لفريقك: ${p.job} في ${p.site}، ${p.when}`,
  },
  job_assigned_worker: {
    en: (p) => `You are assigned to ${p.job} at ${p.site}, ${p.when}`,
    fr: (p) => `Vous êtes affecté à ${p.job} à ${p.site}, ${p.when}`,
    mfe: (p) => `Ou finn gagn travay ${p.job} kot ${p.site}, ${p.when}`,
    ar: (p) => `تم تكليفك بـ ${p.job} في ${p.site}، ${p.when}`,
  },
  worker_arrived: {
    en: (p) => `${p.worker} has arrived at ${p.site}. Please confirm.`,
    fr: (p) => `${p.worker} est arrivé à ${p.site}. Merci de confirmer.`,
    mfe: (p) => `${p.worker} inn ariv kot ${p.site}. Silvouple konfirme.`,
    ar: (p) => `وصل ${p.worker} إلى ${p.site}. يرجى التأكيد.`,
  },
  checkin_flagged: {
    en: (p) => `Flagged check-in: ${p.worker} at ${p.site} (${p.distance} m away). Reason: ${p.reason}`,
    fr: (p) => `Pointage signalé : ${p.worker} à ${p.site} (à ${p.distance} m). Motif : ${p.reason}`,
    mfe: (p) => `Pointaz pa normal: ${p.worker} kot ${p.site} (${p.distance} m lwin). Rezon: ${p.reason}`,
    ar: (p) => `تسجيل حضور مُعلَّم: ${p.worker} في ${p.site} (على بعد ${p.distance} م). السبب: ${p.reason}`,
  },
  worker_late: {
    en: (p) => `No check-in yet for ${p.job} at ${p.site} (due ${p.when})`,
    fr: (p) => `Aucun pointage pour ${p.job} à ${p.site} (prévu ${p.when})`,
    mfe: (p) => `Personn pa'nn pointe ankor pou ${p.job} kot ${p.site} (prevwar ${p.when})`,
    ar: (p) => `لا يوجد تسجيل حضور بعد لـ ${p.job} في ${p.site} (الموعد ${p.when})`,
  },
  arrival_disputed: {
    en: (p) => `Customer disputes arrival for ${p.job} at ${p.site}: ${p.reason}`,
    fr: (p) => `Le client conteste l'arrivée pour ${p.job} à ${p.site} : ${p.reason}`,
    mfe: (p) => `Klian pa dakor ki lekip inn ariv pou ${p.job} kot ${p.site}: ${p.reason}`,
    ar: (p) => `العميل يعترض على الوصول لـ ${p.job} في ${p.site}: ${p.reason}`,
  },
  arrival_auto_confirmed: {
    en: (p) => `Arrival for ${p.job} was confirmed automatically`,
    fr: (p) => `L'arrivée pour ${p.job} a été confirmée automatiquement`,
    mfe: (p) => `Lariv pou ${p.job} finn konfirme otomatikman`,
    ar: (p) => `تم تأكيد الوصول لـ ${p.job} تلقائيًا`,
  },
  job_submitted: {
    en: (p) => `${p.job} at ${p.site} is complete. Please review and approve.`,
    fr: (p) => `${p.job} à ${p.site} est terminé. Merci de vérifier et valider.`,
    mfe: (p) => `${p.job} kot ${p.site} fini. Silvouple get li ek aprouve.`,
    ar: (p) => `اكتمل ${p.job} في ${p.site}. يرجى المراجعة والموافقة.`,
  },
  job_approved: {
    en: (p) => `${p.job} at ${p.site} was approved by the customer`,
    fr: (p) => `${p.job} à ${p.site} a été validé par le client`,
    mfe: (p) => `Klian inn aprouv ${p.job} kot ${p.site}`,
    ar: (p) => `وافق العميل على ${p.job} في ${p.site}`,
  },
  job_auto_approved: {
    en: (p) => `${p.job} at ${p.site} was approved automatically`,
    fr: (p) => `${p.job} à ${p.site} a été validé automatiquement`,
    mfe: (p) => `${p.job} kot ${p.site} finn aprouve otomatikman`,
    ar: (p) => `تمت الموافقة على ${p.job} في ${p.site} تلقائيًا`,
  },
  job_rejected: {
    en: (p) => `${p.job} at ${p.site} was rejected: ${p.reason}`,
    fr: (p) => `${p.job} à ${p.site} a été refusé : ${p.reason}`,
    mfe: (p) => `${p.job} kot ${p.site} finn refize: ${p.reason}`,
    ar: (p) => `تم رفض ${p.job} في ${p.site}: ${p.reason}`,
  },
  job_admin_review: {
    en: (p) => `${p.job} at ${p.site} needs admin review after ${p.count} rejections`,
    fr: (p) => `${p.job} à ${p.site} nécessite une revue après ${p.count} refus`,
    mfe: (p) => `${p.job} kot ${p.site} bizin revizion admin apre ${p.count} refi`,
    ar: (p) => `${p.job} في ${p.site} يحتاج مراجعة الإدارة بعد ${p.count} رفض`,
  },
  job_cancelled: {
    en: (p) => `${p.job} at ${p.site} was cancelled`,
    fr: (p) => `${p.job} à ${p.site} a été annulé`,
    mfe: (p) => `${p.job} kot ${p.site} finn anile`,
    ar: (p) => `تم إلغاء ${p.job} في ${p.site}`,
  },
};

const emails = {
  invite: {
    en: (p) => ({ subject: `You're invited to ${p.company} on FieldProof`, text: `Hello ${p.name},\n\n${p.company} has invited you to FieldProof. Set your password here (link valid 7 days):\n${p.link}\n` }),
    fr: (p) => ({ subject: `Invitation de ${p.company} sur FieldProof`, text: `Bonjour ${p.name},\n\n${p.company} vous invite sur FieldProof. Créez votre mot de passe ici (valable 7 jours) :\n${p.link}\n` }),
    mfe: (p) => ({ subject: `${p.company} pe invit ou lor FieldProof`, text: `Bonzour ${p.name},\n\n${p.company} pe invit ou lor FieldProof. Kreye ou mo-de-pas isi (valab 7 zour):\n${p.link}\n` }),
    ar: (p) => ({ subject: `دعوة من ${p.company} إلى FieldProof`, text: `مرحبًا ${p.name}،\n\nدعتك ${p.company} إلى FieldProof. عيّن كلمة المرور من هنا (صالح 7 أيام):\n${p.link}\n` }),
  },
  reset: {
    en: (p) => ({ subject: 'Reset your FieldProof password', text: `Hello ${p.name},\n\nReset your password here (link valid 1 hour):\n${p.link}\n\nIf you did not ask for this, ignore this email.` }),
    fr: (p) => ({ subject: 'Réinitialiser votre mot de passe FieldProof', text: `Bonjour ${p.name},\n\nRéinitialisez votre mot de passe ici (valable 1 heure) :\n${p.link}\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail.` }),
    mfe: (p) => ({ subject: 'Sanz ou mo-de-pas FieldProof', text: `Bonzour ${p.name},\n\nSanz ou mo-de-pas isi (valab 1 er):\n${p.link}\n\nSi se pa ou ki'nn demande, pa okip sa imel la.` }),
    ar: (p) => ({ subject: 'إعادة تعيين كلمة مرور FieldProof', text: `مرحبًا ${p.name}،\n\nأعد تعيين كلمة المرور من هنا (صالح ساعة واحدة):\n${p.link}\n\nإذا لم تطلب ذلك، تجاهل هذه الرسالة.` }),
  },
};

const pick = (table, lang) => table[lang] || table.en;

export function notificationText(type, lang, params) {
  const tpl = t[type];
  return tpl ? pick(tpl, lang)(params) : type;
}

export function emailText(kind, lang, params) {
  return pick(emails[kind], lang)(params);
}

export const NOTIFICATION_TYPES = Object.keys(t);
