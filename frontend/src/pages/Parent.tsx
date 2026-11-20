import { Route, Routes } from 'react-router-dom';
import { ParentLanding } from '../components/parent/ParentLanding';
import { ParentOrders, ParentOrderDetail } from '../components/parent/ParentOrders';

export default function Parent() {
  return (
    <Routes>
      <Route index element={<ParentLanding />} />
      <Route path="orders" element={<ParentOrders />} />
      <Route path="orders/:id" element={<ParentOrderDetail />} />
    </Routes>
  );
}
