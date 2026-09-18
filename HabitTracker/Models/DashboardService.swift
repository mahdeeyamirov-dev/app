import Foundation

@MainActor
final class DashboardService: ObservableObject {
    @Published var participants: [DashboardParticipant] = []
    @Published var isLoading = false
    @Published var errorMessage: String?

    func refresh(serverURL: String, apiToken: String) async {
        let trimmedURL = serverURL.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedToken = apiToken.trimmingCharacters(in: .whitespacesAndNewlines)

        guard !trimmedURL.isEmpty, !trimmedToken.isEmpty else {
            errorMessage = "Укажите адрес сервера и API-токен в настройках"
            return
        }
        guard let base = URL(string: trimmedURL) else {
            errorMessage = "Некорректный адрес сервера"
            return
        }

        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        var request = URLRequest(url: base.appendingPathComponent("api/dashboard"))
        request.setValue(trimmedToken, forHTTPHeaderField: "x-api-token")

        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let httpResponse = response as? HTTPURLResponse else {
                errorMessage = "Нет ответа от сервера"
                return
            }
            guard httpResponse.statusCode == 200 else {
                errorMessage = httpResponse.statusCode == 401
                    ? "Неверный API-токен"
                    : "Сервер вернул ошибку (\(httpResponse.statusCode))"
                return
            }
            let decoded = try JSONDecoder().decode(DashboardResponse.self, from: data)
            participants = decoded.participants
        } catch {
            errorMessage = "Не удалось подключиться: \(error.localizedDescription)"
        }
    }
}
