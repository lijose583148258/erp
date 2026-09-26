import React from 'react';
import { BomGridLabPage } from './production/bom-grid-lab/BomGridLabPage';
import { RevoGridLab } from './production/bom-grid-lab/RevoGridLab';

export default function BomGridLabRevo() {
  return <BomGridLabPage engine="revogrid" grid={RevoGridLab} />;
}
