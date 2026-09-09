// Fixtures pour tester correctTranscript() (correction Haiku des erreurs STT)
// contre le vrai Claude. `expectedSubstrings` sont les termes techniques que la
// correction DEVRAIT faire apparaître — vérifiés en sous-chaîne insensible à la
// casse, pas en égalité stricte (la reformulation autour peut varier).

export interface GarbledTranscriptFixture {
  name: string;
  raw: string;
  sttContext?: string;
  expectedSubstrings: string[];
}

export const garbledTranscriptFixtures: GarbledTranscriptFixture[] = [
  {
    name: "apis-nodejs-typescript",
    raw: "On expose des pays publiques avec No Jess et taille scripte.",
    sttContext: "Développeur Backend Node.js",
    expectedSubstrings: ["API", "Node.js", "TypeScript"],
  },
  {
    name: "docker-kubernetes",
    raw: "Tout tournait dans des containers dock air orchestrés par quai bernaise.",
    sttContext: "Développeur Backend Docker Kubernetes",
    expectedSubstrings: ["Docker", "Kubernetes"],
  },
  {
    name: "postgresql-http",
    raw: "On gérait les haches TTP directement, la base c'était de la Poste Grèce.",
    sttContext: "Développeur Backend",
    expectedSubstrings: ["HTTP", "PostgreSQL"],
  },
  {
    name: "git-react",
    raw: "Le code était versionné sur Gitte, et le front en réacte.",
    sttContext: "Développeur Frontend React",
    expectedSubstrings: ["Git", "React"],
  },
  {
    name: "clean-input-unchanged",
    raw: "On a mis en place un pipeline CI/CD avec GitHub Actions.",
    sttContext: "Développeur Backend",
    // Rien à corriger ici — vérifie que correctTranscript ne "sur-corrige" pas
    // un texte déjà propre (le check exact est fait dans le test, pas ici).
    expectedSubstrings: ["GitHub Actions"],
  },
];
