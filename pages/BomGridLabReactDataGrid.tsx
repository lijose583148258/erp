import React from 'react';
import { BomGridLabPage } from './production/bom-grid-lab/BomGridLabPage';
import { ReactDataGridLab } from './production/bom-grid-lab/ReactDataGridLab';

export default function BomGridLabReactDataGrid() {
  return <BomGridLabPage engine="react-data-grid" grid={ReactDataGridLab} />;
}
