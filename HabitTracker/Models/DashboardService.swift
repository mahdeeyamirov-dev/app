import Foundation

@MainActor
final class DashboardService: ObservableObject {
    @Published var participants: [ParticipantSnapshot] = []
    @Published var history: [ParticipantHistory] = []
    @Published var isLoading = false
    @Published var errorMessage: String?

    func refreshSnapshot(serverURL: String, apiToken: String) async {
        do {
            let response: SnapshotResponse = try await fetchJSON(
                path: "api/dashboard/base",
                serverURL: serverURL,
                apiToken: apiToken
            )
            participants = response.participants.sorted { $0.percentGreen > $1.percentGreen }
        } catch {
            errorMessage = (error as? DashboardError)?.message ?? error.localizedDescription
        }
    }

    func refreshHistory(serverURL: String, apiToken: String, weeks: Int = 6) async {
        do {
            let response: HistoryResponse = try await fetchJSON(
                path: "api/dashboard/base/history",
                queryItems: [URLQueryItem(name: "weeks", value: String(weeks))],
                serverURL: serverURL,
                apiToken: apiToken
            )
            history = response.participants.sorted { $0.currentPercent > $1.currentPercent }
        } catch {
            errorMessage = (error as? DashboardError)?.message ?? error.localizedDescription
        }
    }

    private func fetchJSON<T: Decodable>(
        path: String,
        queryItems: [URLQueryItem] = [],
        serverURL: String,
        apiToken: String
    ) async throws -> T {
        let trimmedURL = serverURL.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedToken = apiToken.trimmingCharacters(in: .whitespacesAndNewlines)

        guard !trimmedURL.isEmpty, !trimmedToken.isEmpty else {
            throw DashboardError(message: "Укажите адрес сервера и API-токен в настройках")
        }
        guard let base = URL(string: trimmedURL) else {
            throw DashboardError(message: "Некорректный адрес сервера")
        }
        var components = URLComponents(
            url: base.appendingPathComponent(path),
            resolvingAgainstBaseURL: false
        )
        if !queryItems.isEmpty {
            components?.queryItems = queryItems
        }
        guard let url = components?.url else {
            throw DashboardError(message: "Некорректный адрес сервера")
        }

        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        var request = URLRequest(url: url)
        request.setValue(trimmedToken, forHTTPHeaderField: "x-api-token")

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw DashboardError(message: "Нет ответа от сервера")
        }
        guard httpResponse.statusCode == 200 else {
            let message = httpResponse.statusCode == 401
                ? "Неверный API-токен"
                : "Сервер вернул ошибку (\(httpResponse.statusCode))"
            throw DashboardError(message: message)
        }
        return try JSONDecoder().decode(T.self, from: data)
    }
}

struct DashboardError: Error {
    let message: String
}
