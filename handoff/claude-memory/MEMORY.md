# VoxHelp — Memory Index

- [Projet & stack](project-stack.md) — Description produit, monorepo, apps, stack technique
- [Feedback — style de travail](feedback-style.md) — Préférences de collaboration, ton, approche
- [Feedback — config build](feedback-build-config.md) — Règle hook sur vite/tailwind/tsconfig
- [Projet — état actuel](project-state.md) — Ce qui est implémenté, bugs connus, prochaines étapes
- [Projet — audio capture](project-audio.md) — Problèmes VAD/ESM, solution amplitude-based, debug en cours
- [Projet — fusion cards live-assist](project-live-assist-card-merge.md) — Fusion LLM tentée puis annulée (mélange de sous-thèmes), debounce 2500ms conservé
- [Projet — fréquence des relances](project-relance-frequency.md) — Trop peu de questions de relance en test réel (2/7 cards éligibles), à investiguer plus tard
- [Projet — retrait Jargon valide la densité](project-jargon-removal-validates-density.md) — Le retrait de la catégorie Jargon fait l'essentiel du gain de densité, la fusion déterministe n'est qu'un filet marginal
- [Projet — smoke tests LLM](project-llm-smoke-tests.md) — Harness `test:smoke` (vrai Claude) ; callClaudeJSON + paraphrase CV corrigés et vérifiés ; skip live-assist trop agressif toujours ouvert (limite modèle probable, pas juste un prompt à ajuster)
- [Projet — verticale cours](project-cours-verticale.md) — Nouvelle verticale transcription de cours ; post-hoc only pour l'instant (live reporté) ; PDF support = contexte passe 2, pas keyword boosting
- [Projet — STT découplé + Inworld](project-stt-provider-decoupling.md) — Ports LiveStt/BatchStt par env ; Inworld coupe les tours à ~30 s (test sur un cours), à retester sur un vrai entretien avant tout changement de défaut
