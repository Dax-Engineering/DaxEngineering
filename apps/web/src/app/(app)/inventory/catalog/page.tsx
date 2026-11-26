import { canDo, PageHead, SectionCard } from '@dax/web-shell';
import { requirePermission } from '../../../../lib/server';
import { getCatalog } from '../_lib/data';
import {
  AddBrandForm,
  AddModelForm,
  AddTypeForm,
  BrandList,
  ModelList,
  TypeList,
} from './catalog-editor';

export default async function CatalogPage() {
  const caps = await requirePermission('inventory.catalog.view');
  const { brands, machineModels, machineTypes } = await getCatalog();
  const canManage = canDo(caps, 'inventory.catalog.manage');
  const brandOptions = brands
    .filter((b) => b.active)
    .map((b) => ({ value: b.id, label: b.name }));
  const typeOptions = machineTypes
    .filter((t) => t.active)
    .map((t) => ({ value: t.id, label: t.name }));

  return (
    <>
      <PageHead
        back={{ href: '/inventory/stock', label: 'Stock' }}
        title="Brands and machine models"
        lede="Items pick their brand and the machines they fit from these lists. Each machine model can have a type, like Excavator. Turn an entry off instead of deleting it; items keep it."
      />
      <div className="dax-grid2">
        <SectionCard
          title="Brands"
          note={`${brands.length} ${brands.length === 1 ? 'brand' : 'brands'}`}
        >
          <div className="dax-stack" style={{ gap: 16 }}>
            {canManage ? <AddBrandForm /> : null}
            <BrandList brands={brands} canManage={canManage} />
          </div>
        </SectionCard>
        <SectionCard
          title="Machine models"
          note={`${machineModels.length} ${machineModels.length === 1 ? 'model' : 'models'}`}
        >
          <div className="dax-stack" style={{ gap: 16 }}>
            {canManage ? (
              <AddModelForm brands={brandOptions} types={typeOptions} />
            ) : null}
            <ModelList
              models={machineModels}
              brands={brandOptions}
              types={typeOptions}
              canManage={canManage}
            />
          </div>
        </SectionCard>
        <SectionCard
          title="Machine types"
          note={`${machineTypes.length} ${machineTypes.length === 1 ? 'type' : 'types'}`}
        >
          <div className="dax-stack" style={{ gap: 16 }}>
            {canManage ? <AddTypeForm /> : null}
            <TypeList types={machineTypes} canManage={canManage} />
          </div>
        </SectionCard>
      </div>
    </>
  );
}
