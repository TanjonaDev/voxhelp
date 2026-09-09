// Faux CVs "réalistes" pour tester extractCvKeywords contre le vrai Claude.
// Chaque cas documente ce qu'on attend, pour que le check déterministe dans
// verify.ts (chaque keyword doit être une sous-chaîne littérale du texte) ait
// un sens : le danger ici n'est pas l'invention de mots totalement absents
// (le check l'attrape déjà) mais la généralisation abusive (garder "développeur"
// comme si c'était un terme propre au candidat).

export interface CvFixture {
  name: string;
  cvText: string;
  /** termes génériques qui ne devraient PAS ressortir comme keywords */
  shouldNotAppear: string[];
}

export const cvFixtures: CvFixture[] = [
  {
    name: "fullstack-avec-entreprises-et-certifs",
    cvText: `Amina KONE — Développeuse Fullstack

Expérience
- Ingénieure logicielle chez Doctolib (2021-2024) : conception du module de
  prise de rendez-vous, stack Ruby on Rails + React, déploiement sur AWS ECS.
- Développeuse chez Payfit (2019-2021) : API de paie en Node.js/TypeScript,
  base PostgreSQL, message broker Kafka pour la synchronisation inter-services.

Certifications
- AWS Certified Solutions Architect – Associate (2022)
- Certification Scrum Master (PSM I)

Projets personnels
- Créatrice de "Nimbus CLI", un outil open source de déploiement Kubernetes.

Formation
- Master informatique, EPITA (2019)`,
    shouldNotAppear: ["développeur", "développeuse", "expérience", "gestion de projet", "ingénieure"],
  },
  {
    name: "cv-court-peu-de-signal",
    cvText: `Marc DUBOIS
Recherche un poste de développeur web junior.
J'ai fait un bootcamp de 6 mois chez Le Wagon en 2023.
Je connais un peu de JavaScript et de HTML/CSS.`,
    // "bootcamp" est un terme concret (pas générique) qui peut légitimement
    // aider le boosting Deepgram — seuls les descripteurs de poste génériques
    // n'ont pas leur place ici.
    shouldNotAppear: ["développeur web", "junior"],
  },
  {
    name: "cv-sans-signal-specifique",
    cvText: `Candidat motivé avec de l'expérience en gestion de projet et en
développement logiciel. Bon relationnel, travail en équipe, autonomie.
Disponible immédiatement.`,
    shouldNotAppear: ["gestion de projet", "développement logiciel", "travail en équipe", "autonomie"],
  },
];
