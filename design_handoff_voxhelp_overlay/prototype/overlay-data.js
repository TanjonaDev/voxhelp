// VoxHelp — AI interview copilot. Insight data + UI strings (FR / EN).
(function () {
  // status states the copilot cycles through
  const STATUS = {
    listening:  { fr: 'En écoute',       en: 'Listening',          kind: 'idle' },
    speaking:   { fr: 'Candidat parle',  en: 'Candidate speaking', kind: 'live' },
    analyzing:  { fr: 'Analyse…',        en: 'Analyzing…',         kind: 'think' },
  };

  // category metadata. color keys map to CSS vars in the panel.
  const CATEGORIES = {
    translation: { fr: 'Traduction',   en: 'Translation',  color: 'indigo', icon: 'translate' },
    jargon:      { fr: 'Jargon décodé',en: 'Jargon decoded',color: 'violet', icon: 'sparkle' },
    strength:    { fr: 'Point fort',   en: 'Strength',     color: 'good',   icon: 'strength' },
    risk:        { fr: 'À creuser',    en: 'Needs probing',color: 'risk',   icon: 'risk' },
    level:       { fr: 'Niveau technique', en: 'Technical level', color: 'cyan', icon: 'level' },
  };

  const CONFIDENCE = {
    confirmed: { fr: 'Confirmé', en: 'Confirmed', dots: 3, color: 'good' },
    partial:   { fr: 'Partiel',  en: 'Partial',   dots: 2, color: 'warn' },
    low:       { fr: 'À vérifier',en: 'Unverified',dots: 1, color: 'risk' },
  };

  // Live captions that appear in the header strip as the candidate talks.
  const CAPTIONS = [
    { fr: "…donc tout le pipeline tourne en serverless sur AWS, sans serveurs à gérer.",
      en: "…so the whole pipeline runs serverless on AWS, with no servers to manage." },
    { fr: "On utilise DynamoDB pour le temps réel et RDS pour l'historique.",
      en: "We use DynamoDB for real-time and RDS for historical data." },
    { fr: "Pour les pics de trafic, il y a un runbook CDK qui se déclenche automatiquement.",
      en: "For traffic spikes, a CDK runbook kicks in automatically." },
  ];

  // The insight feed. Newest shown first. `pinned` cards are pre-loaded.
  const INSIGHTS = [
    {
      id: 'i1', cat: 'translation', confidence: 'partial', t: '06:58', pinned: true,
      title: { fr: "Profil : développeur backend senior, secteur data média",
               en: "Profile: senior backend developer, media-data sector" },
      body:  { fr: "Le candidat se présente comme développeur backend senior dans un grand groupe média, sur des projets data pour leur CMS interne.",
               en: "The candidate presents as a senior backend developer at a large media group, working on data projects for their internal CMS." },
      relance: { fr: "Quelles technologies utilisez-vous au quotidien sur ces projets data ?",
                 en: "Which technologies do you use day-to-day on these data projects?" },
    },
    {
      id: 'i2', cat: 'jargon', confidence: 'confirmed', t: '07:09', pinned: true,
      title: { fr: "« Serverless », en clair",
               en: "\u201CServerless,\u201D in plain words" },
      body:  { fr: "Le candidat ne gère aucun serveur lui-même : AWS exécute le code à la demande et facture à l'usage. C'est un signe de modernité et de maîtrise des coûts.",
               en: "The candidate manages no servers himself: AWS runs the code on demand and bills per use. A sign of a modern, cost-aware approach." },
      relance: null,
    },
    {
      id: 'i3', cat: 'strength', confidence: 'confirmed', t: '07:14', pinned: true,
      title: { fr: "Vision claire de la chaîne de traitement data",
               en: "Clear view of the data processing chain" },
      body:  { fr: "Il intègre des données de plusieurs sources externes et les expose aux équipes éditoriales via une architecture serverless AWS.",
               en: "He integrates data from several external sources and exposes it to editorial teams through a serverless AWS architecture." },
      relance: { fr: "Quels services AWS serverless utilisez-vous concrètement pour cette architecture ?",
                 en: "Which serverless AWS services do you actually use for this architecture?" },
    },
    {
      id: 'i4', cat: 'level', confidence: 'confirmed', t: '07:31', pinned: true,
      level: 0.82, levelLabel: { fr: 'Senior', en: 'Senior' },
      title: { fr: "Architecture serverless réellement maîtrisée",
               en: "Genuinely strong serverless architecture skills" },
      body:  { fr: "Pipeline complet décrit : déclencheurs programmés, files d'attente et bases NoSQL pour traiter des données sportives en temps réel.",
               en: "Describes a full pipeline: scheduled triggers, queues and NoSQL stores to process sports data in real time." },
      relance: { fr: "Comment gérez-vous la montée en charge et les pics de trafic sur ce pipeline ?",
                 en: "How do you handle scaling and traffic spikes on this pipeline?" },
    },
    // --- streamed in live ---
    {
      id: 'i5', cat: 'strength', confidence: 'confirmed', t: '07:42',
      title: { fr: "Choix techniques event-driven cohérents",
               en: "Coherent event-driven technical choices" },
      body:  { fr: "DynamoDB pour le temps réel, RDS pour l'historique, et un système d'événements qui automatise la création d'articles.",
               en: "DynamoDB for real-time, RDS for history, and an event system that automates article creation." },
      relance: { fr: "Comment assurez-vous la cohérence des données entre DynamoDB et RDS ?",
                 en: "How do you keep data consistent between DynamoDB and RDS?" },
    },
    {
      id: 'i6', cat: 'risk', confidence: 'partial', t: '07:54',
      title: { fr: "Gestion des pics de charge : explication incomplète",
               en: "Spike handling: explanation is incomplete" },
      body:  { fr: "Il anticipe des pics prévisibles via un système automatisé, mais sa réponse reste vague sur l'implémentation technique réelle.",
               en: "He anticipates predictable spikes with an automated system, but his answer stays vague on the actual technical implementation." },
      relance: { fr: "Pouvez-vous détailler ce que fait concrètement ce runbook CDK, et quels services AWS il déclenche ?",
                 en: "Can you detail what this CDK runbook actually does, and which AWS services it triggers?" },
    },
  ];

  // UI chrome strings
  const UI = {
    brand: 'VoxHelp',
    connected: { fr: 'Connecté', en: 'Connected' },
    analysis: { fr: 'Analyse en direct', en: 'Live analysis' },
    candidate: { fr: 'Tanjona Rakotoarisoa', en: 'Tanjona Rakotoarisoa' },
    role: { fr: 'Développeur Backend · Entretien technique', en: 'Backend Developer · Technical interview' },
    meansLabel: { fr: 'Ce que ça veut dire', en: 'What this means' },
    askLabel: { fr: 'Question de relance', en: 'Follow-up question' },
    liveCaption: { fr: 'Transcription en direct', en: 'Live transcript' },
    ask: { fr: 'Demandez à VoxHelp…', en: 'Ask VoxHelp…' },
    recording: { fr: 'En cours', en: 'Recording' },
    stop: { fr: 'Arrêter', en: 'Stop' },
    hide: { fr: 'Masquer', en: 'Hide' },
    actions: {
      assist:   { fr: 'Assister',  en: 'Assist' },
      followups:{ fr: 'Relances',  en: 'Follow-ups' },
      recap:    { fr: 'Récap',     en: 'Recap' },
      copy:     { fr: 'Copier',    en: 'Copy' },
      pin:      { fr: 'Épingler',  en: 'Pin' },
    },
  };

  window.VOX = { STATUS, CATEGORIES, CONFIDENCE, CAPTIONS, INSIGHTS, UI };
})();
