import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from '@/components/ui/AppShell';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { MnemonicPage } from '@/features/mnemonic/MnemonicPage';
import { ModelsPage } from '@/features/models/ModelsPage';
import { RecommendationPage } from '@/features/recommendation/RecommendationPage';
import { ReporterPage } from '@/features/reporter/ReporterPage';
import { WhatIfPage } from '@/features/whatif/WhatIfPage';

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/recommendation" element={<RecommendationPage />} />
        <Route path="/recommendation/:runId" element={<RecommendationPage />} />
        <Route path="/whatif" element={<WhatIfPage />} />
        <Route path="/mnemonic" element={<MnemonicPage />} />
        <Route path="/models" element={<ModelsPage />} />
        <Route path="/data" element={<ReporterPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
