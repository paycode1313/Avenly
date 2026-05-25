/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import MapboxView from './components/MapboxView';
import NavigateView from './components/NavigateView';
import SocialFeed from './components/SocialFeed';
import ProfileView from './components/ProfileView';

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<MapboxView />} />
          <Route path="navigate" element={<NavigateView />} />
          <Route path="social" element={<SocialFeed />} />
          <Route path="profile" element={<ProfileView />} />
        </Route>
      </Routes>
    </Router>
  );
}
