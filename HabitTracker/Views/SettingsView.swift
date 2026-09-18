import SwiftUI

struct SettingsView: View {
    @AppStorage("serverURL") private var serverURL = ""
    @AppStorage("apiToken") private var apiToken = ""
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Настройки сервера")
                .font(.headline)

            VStack(alignment: .leading, spacing: 4) {
                Text("Адрес сервера")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                TextField("https://your-app.example.com", text: $serverURL)
                    .textFieldStyle(.roundedBorder)
            }

            VStack(alignment: .leading, spacing: 4) {
                Text("API-токен")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                SecureField("Такой же, как в .env сервера", text: $apiToken)
                    .textFieldStyle(.roundedBorder)
            }

            HStack {
                Spacer()
                Button("Готово") { dismiss() }
                    .keyboardShortcut(.defaultAction)
            }
        }
        .padding(20)
        .frame(width: 360)
    }
}
