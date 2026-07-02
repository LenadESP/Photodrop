import { Route, Routes } from 'react-router';
import { Home } from './pages/Home';
import { Login } from './pages/Login';
import { Gallery } from './pages/Gallery';
import { Admin } from './pages/Admin';

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/login" element={<Login />} />
      <Route path="/a/:uid" element={<Gallery />} />
      <Route path="/admin" element={<Admin />} />
      <Route path="*" element={<Home />} />
    </Routes>
  );
}
