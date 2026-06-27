import React from 'react';
import ComponentCreator from '@docusaurus/ComponentCreator';

export default [
  {
    path: '/en/docs',
    component: ComponentCreator('/en/docs', '7e2'),
    routes: [
      {
        path: '/en/docs',
        component: ComponentCreator('/en/docs', 'b98'),
        routes: [
          {
            path: '/en/docs',
            component: ComponentCreator('/en/docs', 'fe9'),
            routes: [
              {
                path: '/en/docs/api/agents',
                component: ComponentCreator('/en/docs/api/agents', 'ea2'),
                exact: true,
                sidebar: "docSidebar"
              },
              {
                path: '/en/docs/api/groups',
                component: ComponentCreator('/en/docs/api/groups', '78b'),
                exact: true,
                sidebar: "docSidebar"
              },
              {
                path: '/en/docs/api/memories',
                component: ComponentCreator('/en/docs/api/memories', 'bd1'),
                exact: true,
                sidebar: "docSidebar"
              },
              {
                path: '/en/docs/api/overview',
                component: ComponentCreator('/en/docs/api/overview', '377'),
                exact: true,
                sidebar: "docSidebar"
              },
              {
                path: '/en/docs/api/workflows',
                component: ComponentCreator('/en/docs/api/workflows', '9a8'),
                exact: true,
                sidebar: "docSidebar"
              },
              {
                path: '/en/docs/architecture/agent-system',
                component: ComponentCreator('/en/docs/architecture/agent-system', 'b41'),
                exact: true,
                sidebar: "docSidebar"
              },
              {
                path: '/en/docs/architecture/core-concepts',
                component: ComponentCreator('/en/docs/architecture/core-concepts', 'c6e'),
                exact: true,
                sidebar: "docSidebar"
              },
              {
                path: '/en/docs/architecture/mcp-integration',
                component: ComponentCreator('/en/docs/architecture/mcp-integration', '0aa'),
                exact: true,
                sidebar: "docSidebar"
              },
              {
                path: '/en/docs/architecture/overview',
                component: ComponentCreator('/en/docs/architecture/overview', '05a'),
                exact: true,
                sidebar: "docSidebar"
              },
              {
                path: '/en/docs/architecture/tool-system',
                component: ComponentCreator('/en/docs/architecture/tool-system', '8d8'),
                exact: true,
                sidebar: "docSidebar"
              },
              {
                path: '/en/docs/architecture/workflow-engine',
                component: ComponentCreator('/en/docs/architecture/workflow-engine', '878'),
                exact: true,
                sidebar: "docSidebar"
              },
              {
                path: '/en/docs/deployment/configuration',
                component: ComponentCreator('/en/docs/deployment/configuration', '75d'),
                exact: true,
                sidebar: "docSidebar"
              },
              {
                path: '/en/docs/deployment/overview',
                component: ComponentCreator('/en/docs/deployment/overview', '0b3'),
                exact: true,
                sidebar: "docSidebar"
              },
              {
                path: '/en/docs/deployment/production',
                component: ComponentCreator('/en/docs/deployment/production', '63c'),
                exact: true,
                sidebar: "docSidebar"
              },
              {
                path: '/en/docs/deployment/quickstart',
                component: ComponentCreator('/en/docs/deployment/quickstart', '7eb'),
                exact: true,
                sidebar: "docSidebar"
              },
              {
                path: '/en/docs/intro',
                component: ComponentCreator('/en/docs/intro', '1d8'),
                exact: true,
                sidebar: "docSidebar"
              }
            ]
          }
        ]
      }
    ]
  },
  {
    path: '/en/',
    component: ComponentCreator('/en/', '6c2'),
    exact: true
  },
  {
    path: '*',
    component: ComponentCreator('*'),
  },
];
