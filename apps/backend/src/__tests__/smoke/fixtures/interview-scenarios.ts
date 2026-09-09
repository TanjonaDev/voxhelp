import type { JobContext } from "@voxhelp/shared";

export interface InterviewTurn {
  /** timestamp "mm:ss" qu'on contrôle nous-mêmes (on ne passe pas par Session) */
  t: string;
  /** ce qui a été "transcrit" — peut être volontairement dégradé (erreurs STT) */
  text: string;
  /** true si ce tour doit produire [skip] (question recruteur ou rien de nouveau) */
  expectSkip?: boolean;
}

export interface InterviewScenario {
  name: string;
  jobContext?: JobContext;
  candidateName?: string;
  turns: InterviewTurn[];
  /**
   * Compétences listées dans la stack visée (jobContext.stack) mais JAMAIS
   * mentionnées par le candidat dans les turns — appât à hallucination pour
   * techMatching : ces skills doivent ressortir "non-aborde" dans le bilan,
   * jamais "demontre"/"mentionne" avec une citation inventée.
   */
  neverSpoken?: string[];
}

export const interviewScenarios: InterviewScenario[] = [
  {
    name: "clean-fullstack-strong",
    jobContext: { title: "Développeur Fullstack", level: "Confirmé", stack: "Node.js, PostgreSQL, React, AWS" },
    candidateName: "Julien Martin",
    turns: [
      { t: "00:05", text: "Pouvez-vous me parler d'un projet où vous avez eu un impact concret ?", expectSkip: true },
      {
        t: "00:20",
        text: "Chez mon employeur précédent, j'ai conçu seul le pipeline de traitement des commandes, en Node.js avec une base PostgreSQL. On avait des pics de charge le vendredi soir et le système plantait régulièrement. J'ai mis en place une file d'attente avec des workers, ça a réduit les erreurs de 90% et le temps de traitement moyen est passé de 12 secondes à 2 secondes.",
      },
      { t: "00:55", text: "Et côté frontend, vous avez de l'expérience ?", expectSkip: true },
      {
        t: "01:05",
        text: "Oui, j'ai fait toute la refonte du dashboard client en React avec TypeScript, en remplaçant une vieille app jQuery. On a gagné en vélocité pour ajouter de nouvelles fonctionnalités.",
      },
      {
        t: "01:40",
        text: "On déployait sur AWS avec ECS, j'avais mis en place les pipelines CI/CD avec GitHub Actions.",
      },
    ],
  },
  {
    name: "stt-garbled-transcription",
    jobContext: { title: "Développeur Backend", level: "Senior", stack: "Node.js, Docker, Kubernetes" },
    candidateName: "Karim Belkacem",
    turns: [
      {
        t: "00:10",
        text: "On a mis en place des pays publiques exposées avec No Jess et taille scripte, tout tournait dans des containers dock air orchestrés par quai bernaise.",
      },
      {
        t: "00:40",
        text: "On gérait les haches TTP directement, et pour la mise en cache on utilisait Redis côté Sarra.",
      },
      {
        t: "01:10",
        text: "Le plus dur ça a été un bug où l'inscrire pour s'exécuter ne se lançait jamais en prod, un souci de guite mal configuré sur le pipeline.",
      },
    ],
  },
  {
    name: "cv-stack-never-spoken",
    jobContext: { title: "Développeur Data", level: "Confirmé", stack: "Python, Kafka, Kubernetes, Rust" },
    candidateName: "Sophie Nguyen",
    neverSpoken: ["Kafka", "Kubernetes", "Rust"],
    turns: [
      {
        t: "00:08",
        text: "Mon rôle principal a été de construire des pipelines ETL en Python avec Airflow, qui alimentaient nos modèles de scoring. On traitait environ 2 millions de lignes par jour, stockées dans PostgreSQL.",
      },
      {
        t: "00:45",
        text: "J'ai aussi mis en place des tests de qualité de données avec Great Expectations pour éviter que des données corrompues remontent en prod.",
      },
      { t: "01:15", text: "Vous avez déjà travaillé avec des architectures de streaming ?", expectSkip: true },
      {
        t: "01:25",
        text: "On en a entendu parler en réunion mais ce n'est pas moi qui ai travaillé dessus directement.",
      },
    ],
  },
  {
    name: "vague-weak-answers",
    jobContext: { title: "Développeur Frontend", level: "Junior", stack: "React, TypeScript" },
    turns: [
      {
        t: "00:05",
        text: "J'ai un peu touché à React pendant ma formation, mais je ne suis pas hyper à l'aise, j'ai surtout suivi des tutos.",
      },
      {
        t: "00:30",
        text: "Pour TypeScript honnêtement je connais le nom mais je n'ai jamais vraiment codé avec.",
      },
      { t: "00:50", text: "Et le travail en équipe, ça se passait comment ?", expectSkip: true },
      { t: "01:00", text: "Ça allait, on était 3 sur le projet de fin d'études, chacun faisait un peu sa partie." },
    ],
  },
  {
    name: "recruiter-questions-only",
    jobContext: { title: "Développeur Backend", level: "Confirmé", stack: "Java, Spring" },
    turns: [
      { t: "00:05", text: "Parlez-moi de votre parcours.", expectSkip: true },
      { t: "00:15", text: "Quelles technologies maîtrisez-vous le mieux ?", expectSkip: true },
      { t: "00:25", text: "Comment gérez-vous le stress en période de rush ?", expectSkip: true },
    ],
  },
  {
    name: "empty-session",
    jobContext: { title: "Développeur Mobile", level: "Confirmé", stack: "Swift, Kotlin" },
    turns: [],
  },
];
