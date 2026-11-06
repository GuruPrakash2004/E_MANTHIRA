import { Alert, Card, Stack, Text } from '@mantine/core'
import { DatabaseZap, Settings } from 'lucide-react'
import { Link } from 'react-router-dom'

/**
 * Shown by a screen whose legacy feature cannot run in this database. The web app never creates tables or invents values:
 *  - `missing`          = tables this database does not have; the screen starts working by itself where they exist.
 *  - `missingSettings`  = UtlGSettings rows the feature reads its rules from; an admin adds them in Global Settings
 *                         (group `settingGroup`) and the screen starts working at once.
 */
export default function NotAvailableHere({ feature, missing = [], missingSettings = [], settingGroup = '', settingHelp = {} }) {
  if (missingSettings.length) {
    return (
      <Card withBorder p="lg">
        <Alert color="kumkum" variant="light" icon={<Settings size={18} />} title={`${feature} is not set up in this database`}>
          <Text size="sm">
            Its rules are read from the database, not built into the app. Add {missingSettings.length > 1 ? 'these settings' : 'this setting'} in{' '}
            <Link to="/settings/admin-master?tab=global-settings">Global Settings</Link>
            {settingGroup ? <> (group <b>{settingGroup}</b>)</> : null}: <b>{missingSettings.join(', ')}</b>.
          </Text>
          {Object.keys(settingHelp).length > 0 && (
            <Stack gap={4} mt="xs">
              <Text size="xs" c="dimmed">Value format (Add in Global Settings, group {settingGroup}; the name is the setting name, the value is written like this):</Text>
              {Object.entries(settingHelp).map(([k, v]) => (
                <Text key={k} size="xs" ff="monospace"><b>{k}</b>  {v}</Text>
              ))}
            </Stack>
          )}
        </Alert>
      </Card>
    )
  }
  return (
    <Card withBorder p="lg">
      <Alert color="kumkum" variant="light" icon={<DatabaseZap size={18} />} title={`${feature} is not available in this database`}>
        <Text size="sm">
          {missing.length ? (
            <>
              This database does not have {missing.length > 1 ? 'these tables' : 'the table'} the feature runs on: <b>{missing.join(', ')}</b>.
            </>
          ) : (
            'This database does not have the data this feature runs on.'
          )}{' '}
          Nothing is broken and nothing was changed. The screen starts working on its own in a database that has it.
        </Text>
      </Alert>
    </Card>
  )
}
