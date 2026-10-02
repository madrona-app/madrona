import { Providers } from './app/providers';
import { AppRoutes } from './app/routeConfig';

function App() {
  return (
    <Providers>
      <AppRoutes />
    </Providers>
  );
}

export default App;
